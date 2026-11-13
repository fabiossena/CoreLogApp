//
//  CoreLogLocationManager.swift
//  CoreLogMobile
//
//  Native iOS background-location engine.
//
//  Responsibilities (all asynchronous work happens OFF the React Native JS
//  thread, so collection and delivery continue while the UI is closed):
//    * CoreLocation background updates (`startUpdatingLocation` +
//      `allowsBackgroundLocationUpdates`), started from the foreground.
//    * Sampling throttle: one position every `positionIntervalSeconds`.
//    * Native batching: `batchSize` positions (or 5 minutes) per POST to
//      `POST /api/tracking/events`, exactly like the Android service.
//    * Offline buffering in SQLite (`CoreLogStore`) + exponential backoff
//      retry when the network is unavailable.
//    * High-priority panic queue drain.
//    * Remote-command effects: SET_FREQUENCY, SILENCE, REACTIVATE,
//      REQUEST_IMMEDIATE_POSITION.
//
//  The class exposes an observable snapshot (`onStateChanged`) consumed by the
//  React Native module (`CoreLogBackgroundService.swift`).
//

import CoreLocation
import Foundation

/// Snapshot of the service state, mirrored to JavaScript.
struct CoreLogTrackingState {
    /// Whether native collection is running.
    var trackingEnabled: Bool = false
    /// ISO-8601 UTC of the last successful upload, or `nil`.
    var lastSendAtUtc: String? = nil
    /// Rows waiting in the offline queue.
    var pendingCount: Int = 0
    /// ISO-8601 UTC until which sending is silenced, or `nil`.
    var silencedUntilUtc: String? = nil
    /// Current sampling period in seconds.
    var intervalSeconds: Int = 60
}

/// CoreLocation-backed background tracking engine.
final class CoreLogLocationManager: NSObject, CLLocationManagerDelegate {

    /// Shared engine instance.
    static let shared = CoreLogLocationManager()

    /// Invoked on the main thread whenever the state changes.
    var onStateChanged: ((CoreLogTrackingState) -> Void)?

    // MARK: - Configuration (persisted so remote commands survive restarts)

    private enum Keys {
        static let baseUrl = "corelog.baseUrl"
        static let vehicleId = "corelog.vehicleId"
        static let batchSize = "corelog.batchSize"
        static let interval = "corelog.intervalSeconds"
        static let silencedUntil = "corelog.silencedUntilMs"
        static let trackingEnabled = "corelog.trackingEnabled"
        static let lastSend = "corelog.lastSendAtUtc"
        static let lastLat = "corelog.lastLat"
        static let lastLon = "corelog.lastLon"
        static let lastSpeed = "corelog.lastSpeed"
        static let lastTimestamp = "corelog.lastTimestampUtc"
    }

    private let defaults = UserDefaults.standard
    private let locationManager = CLLocationManager()
    private let store = CoreLogStore.shared

    /// Positions collected but not yet uploaded.
    private var pendingBatch: [[String: Any]] = []
    /// When the current batch started (5-minute flush deadline).
    private var batchStartedAt: Date?
    /// Last accepted sample time (sampling throttle).
    private var lastSampleAt: Date?
    /// Retry backoff in seconds (1, 5, 15, 30, capped).
    private var uploadBackoff: TimeInterval = 1
    /// Guards `uploadInFlight`.
    private var uploading = false

    private override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.pausesLocationUpdatesAutomatically = false
        // Keep delivering locations when the app is backgrounded/locked.
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
    }

    // MARK: - Public API (called from the RN module)

    var state: CoreLogTrackingState {
        CoreLogTrackingState(
            trackingEnabled: isTrackingEnabled,
            lastSendAtUtc: defaults.string(forKey: Keys.lastSend),
            pendingCount: pendingBatch.count + store.count(),
            silencedUntilUtc: silencedUntilUtc(),
            intervalSeconds: defaults.object(forKey: Keys.interval) as? Int ?? 60
        )
    }

    var isTrackingEnabled: Bool {
        defaults.bool(forKey: Keys.trackingEnabled)
    }

    /// Applies the start configuration and begins background updates.
    ///
    /// - Parameters:
    ///   - coreLogBaseUrl: CoreLog REST base URL (no trailing slash).
    ///   - vehicleId: vehicle bound to this installation.
    ///   - batchSize: positions per upload batch.
    ///   - intervalSeconds: seconds between two samples.
    func start(coreLogBaseUrl: String, vehicleId: String, batchSize: Int, intervalSeconds: Int) {
        defaults.set(coreLogBaseUrl, forKey: Keys.baseUrl)
        defaults.set(vehicleId, forKey: Keys.vehicleId)
        defaults.set(max(1, batchSize), forKey: Keys.batchSize)
        defaults.set(max(5, intervalSeconds), forKey: Keys.interval)
        defaults.set(true, forKey: Keys.trackingEnabled)

        // Must be called while the app is in the foreground (spec requirement).
        locationManager.requestAlwaysAuthorization()
        locationManager.startUpdatingLocation()
        notifyStateChanged()
    }

    /// Stops background updates (buffered data is preserved and drained later).
    func stop() {
        defaults.set(false, forKey: Keys.trackingEnabled)
        locationManager.stopUpdatingLocation()
        notifyStateChanged()
        // Best-effort final flush; the queue keeps anything that fails.
        drainQueues()
    }

    /// Applies `SET_FREQUENCY`.
    ///
    /// - Parameter seconds: new sampling period (clamped to 5...3600).
    func setPositionInterval(seconds: Int) {
        defaults.set(min(3600, max(5, seconds)), forKey: Keys.interval)
        notifyStateChanged()
    }

    /// Applies `SILENCE` for the given duration.
    ///
    /// - Parameter durationSeconds: silence window length.
    func silence(durationSeconds: Int) {
        let until = Date().addingTimeInterval(TimeInterval(max(1, durationSeconds)))
        defaults.set(until.timeIntervalSince1970 * 1000, forKey: Keys.silencedUntil)
        notifyStateChanged()
    }

    /// Applies `REACTIVATE`: clears the silence window immediately.
    func reactivate() {
        defaults.removeObject(forKey: Keys.silencedUntil)
        notifyStateChanged()
        drainQueues()
    }

    /// Applies `REQUEST_IMMEDIATE_POSITION`: samples and flushes at once.
    func requestImmediatePosition() {
        locationManager.requestLocation()
        drainQueues(force: true)
    }

    /// Queues a panic and drains the high-priority queue.
    ///
    /// - Parameters:
    ///   - payload: panic JSON object.
    ///   - eventId: stable id used as the SQLite primary key.
    func enqueuePanic(payload: [String: Any], eventId: String) {
        store.appendPanic(jsonString(payload), eventId: eventId)
        notifyStateChanged()
        drainQueues(force: true)
    }

    /// Last known position, as required by the panic payload.
    func lastKnownPosition() -> [String: Any]? {
        guard
            let latitude = defaults.object(forKey: Keys.lastLat) as? Double,
            let longitude = defaults.object(forKey: Keys.lastLon) as? Double,
            let timestamp = defaults.string(forKey: Keys.lastTimestamp)
        else { return nil }
        var position: [String: Any] = [
            "latitude": latitude,
            "longitude": longitude,
            "timestamp_utc": timestamp,
        ]
        if let speed = defaults.object(forKey: Keys.lastSpeed) as? Double {
            position["speed_kmh"] = speed
        }
        return position
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard isTrackingEnabled, let location = locations.last else { return }

        // Sampling throttle: honour the configured interval.
        let interval = TimeInterval(defaults.object(forKey: Keys.interval) as? Int ?? 60)
        if let last = lastSampleAt, Date().timeIntervalSince(last) < interval {
            return
        }
        lastSampleAt = Date()

        let position = makePosition(location)
        persistLastKnown(location, position: position)

        // A `REQUEST_IMMEDIATE_POSITION` still needs to reach the backend even
        // during a silence window, but routine sampling is suppressed.
        if isSilenced {
            return
        }
        pendingBatch.append(position)
        if batchStartedAt == nil {
            batchStartedAt = Date()
        }
        notifyStateChanged()
        flushIfBatchReady()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        NSLog("[CoreLogLocationManager] location error: %@", error.localizedDescription)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if status == .denied || status == .restricted {
            NSLog("[CoreLogLocationManager] location permission denied")
            stop()
        }
    }

    // MARK: - Batching / upload

    /// Flushes the in-memory batch when it is full or 5 minutes old.
    private func flushIfBatchReady() {
        let batchSize = max(1, defaults.object(forKey: Keys.batchSize) as? Int ?? 10)
        let tooOld = batchStartedAt.map { Date().timeIntervalSince($0) >= 5 * 60 } ?? false
        if pendingBatch.count >= batchSize || tooOld {
            enqueuePendingBatch()
        }
        drainQueues()
    }

    /// Moves the in-memory batch into SQLite (durable) before uploading.
    private func enqueuePendingBatch() {
        guard !pendingBatch.isEmpty else { return }
        for position in pendingBatch {
            let eventId = UUID().uuidString
            store.appendPosition(jsonString(position), eventId: eventId)
        }
        pendingBatch.removeAll()
        batchStartedAt = nil
    }

    /// Drains panics first, then positions, honouring the retry backoff.
    ///
    /// - Parameter force: ignores the silence window (used by REACTIVATE and
    ///   panic delivery).
    func drainQueues(force: Bool = false) {
        enqueuePendingBatch()
        guard !uploading, store.count() > 0 else {
            notifyStateChanged()
            return
        }
        uploading = true

        // Panics are always drained (their own endpoint), then positions only
        // when not silenced.
        drainPanics { [weak self] in
            guard let self = self else { return }
            if !force && self.isSilenced {
                self.uploading = false
                self.notifyStateChanged()
                return
            }
            self.drainPositions()
        }
    }

    private func drainPanics(completion: @escaping () -> Void) {
        let rows = store.peek(kind: .panics, limit: 20)
        guard !rows.isEmpty else { return completion() }

        let group = DispatchGroup()
        var delivered: [String] = []
        for row in rows {
            group.enter()
            post(path: "/api/panic", body: row.payload) { success in
                if success { delivered.append(row.eventId) }
                group.leave()
            }
        }
        group.notify(queue: .global(qos: .utility)) { [weak self] in
            self?.store.delete(kind: .panics, eventIds: delivered)
            completion()
        }
    }

    private func drainPositions() {
        let batchSize = max(1, defaults.object(forKey: Keys.batchSize) as? Int ?? 10)
        let rows = store.peek(kind: .positions, limit: batchSize)
        guard !rows.isEmpty else {
            uploading = false
            notifyStateChanged()
            return
        }

        // POST /api/tracking/events expects a JSON array of positions.
        let payloads = rows.compactMap { row -> [String: Any]? in
            guard let data = row.payload.data(using: .utf8) else { return nil }
            return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        }

        postBatch(path: "/api/tracking/events", positions: payloads) { [weak self] success in
            guard let self = self else { return }
            if success {
                self.store.delete(kind: .positions, eventIds: rows.map { $0.eventId })
                self.defaults.set(isoUtc(Date()), forKey: Keys.lastSend)
                self.uploadBackoff = 1
            } else {
                // Exponential backoff (1s, 5s, 15s, 30s, capped at 60s).
                self.uploadBackoff = min(60, self.uploadBackoff * 3 + 2)
            }
            self.uploading = false
            self.notifyStateChanged()
            if success && self.store.count() > 0 {
                // Keep draining eagerly while the network is healthy.
                self.drainQueues(force: true)
            } else if !success {
                self.scheduleRetry()
            }
        }
    }

    private func scheduleRetry() {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + uploadBackoff) { [weak self] in
            self?.drainQueues()
        }
    }

    // MARK: - HTTP

    private func post(path: String, body: String, completion: @escaping (Bool) -> Void) {
        guard let url = endpoint(path) else { return completion(false) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body.data(using: .utf8)
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { _, response, error in
            completion(error == nil && CoreLogLocationManager.isSuccess(response))
        }.resume()
    }

    private func postBatch(path: String, positions: [[String: Any]], completion: @escaping (Bool) -> Void) {
        guard !positions.isEmpty else { return completion(true) }
        guard let url = endpoint(path), let data = try? JSONSerialization.data(withJSONObject: positions) else {
            return completion(false)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { _, response, error in
            completion(error == nil && CoreLogLocationManager.isSuccess(response))
        }.resume()
    }

    private static func isSuccess(_ response: URLResponse?) -> Bool {
        guard let http = response as? HTTPURLResponse else { return false }
        return (200...299).contains(http.statusCode)
    }

    private func endpoint(_ path: String) -> URL? {
        guard let base = defaults.string(forKey: Keys.baseUrl), !base.isEmpty else { return nil }
        return URL(string: base.hasSuffix("/") ? String(base.dropLast()) + path : base + path)
    }

    // MARK: - Helpers

    private var isSilenced: Bool {
        silencedUntilUtc() != nil
    }

    private func silencedUntilUtc() -> String? {
        let until = defaults.double(forKey: Keys.silencedUntil)
        guard until > 0, until > Date().timeIntervalSince1970 * 1000 else { return nil }
        return isoUtc(Date(timeIntervalSince1970: until / 1000))
    }

    private func makePosition(_ location: CLLocation) -> [String: Any] {
        var position: [String: Any] = [
            "vehicle_id": defaults.string(forKey: Keys.vehicleId) ?? "",
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "timestamp_utc": isoUtc(location.timestamp),
        ]
        if location.speed >= 0 {
            position["speed_kmh"] = location.speed * 3.6
        }
        return position
    }

    private func persistLastKnown(_ location: CLLocation, position: [String: Any]) {
        defaults.set(location.coordinate.latitude, forKey: Keys.lastLat)
        defaults.set(location.coordinate.longitude, forKey: Keys.lastLon)
        if location.speed >= 0 {
            defaults.set(location.speed * 3.6, forKey: Keys.lastSpeed)
        }
        defaults.set(position["timestamp_utc"], forKey: Keys.lastTimestamp)
    }

    private func notifyStateChanged() {
        let snapshot = state
        DispatchQueue.main.async { [weak self] in
            self?.onStateChanged?(snapshot)
        }
    }

    private func jsonString(_ object: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return "{}" }
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private func isoUtc(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }
}
