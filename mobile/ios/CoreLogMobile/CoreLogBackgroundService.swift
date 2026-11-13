//
//  CoreLogBackgroundService.swift
//  CoreLogMobile
//
//  `NativeModules.CoreLogBackgroundService` on iOS — the JavaScript façade
//  consumed by `BackgroundServiceBridge`.
//
//  It forwards every call to `CoreLogLocationManager` (the native engine) and
//  pushes state changes to JavaScript through the
//  `CoreLogBackgroundService.state` event, so the bridge's snapshot stays in
//  sync — exactly like the Android `CoreLogBackgroundServiceModule`.
//
//  The RN module itself performs no location work: that keeps the JS thread
//  free and lets collection continue while the UI is closed.
//

import Foundation
import React

/// Event name emitted to JavaScript on every state change.
private let coreLogStateEvent = "CoreLogBackgroundService.state"

/// React Native module bridging JS to `CoreLogLocationManager`.
@objc(CoreLogBackgroundService)
final class CoreLogBackgroundService: RCTEventEmitter {

    private let manager = CoreLogLocationManager.shared
    /// Set while JavaScript has an active `NativeEventEmitter` subscription.
    private var isObserving = false

    override init() {
        super.init()
        manager.onStateChanged = { [weak self] _ in
            self?.emitState()
        }
    }

    /// The module must be created on the main queue because it touches
    /// `CLLocationManager`.
    @objc
    override static func requiresMainQueueSetup() -> Bool { true }

    override func supportedEvents() -> [String]! {
        [coreLogStateEvent]
    }

    override func startObserving() {
        isObserving = true
    }

    override func stopObserving() {
        isObserving = false
    }

    // MARK: - Lifecycle

    @objc(start:resolver:rejecter:)
    func start(
        _ config: NSDictionary,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        let baseUrl = config["coreLogBaseUrl"] as? String ?? ""
        let vehicleId = config["vehicleId"] as? String ?? ""
        let batchSize = config["batchSize"] as? Int ?? 10
        let interval = config["positionIntervalSeconds"] as? Int ?? 60

        manager.start(
            coreLogBaseUrl: baseUrl,
            vehicleId: vehicleId,
            batchSize: batchSize,
            intervalSeconds: interval
        )
        resolve(nil)
    }

    @objc(stop:rejecter:)
    func stop(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        manager.stop()
        resolve(nil)
    }

    @objc(getState:rejecter:)
    func getState(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        resolve(stateDictionary())
    }

    // MARK: - Remote commands

    @objc(setPositionInterval:resolver:rejecter:)
    func setPositionInterval(
        _ seconds: NSNumber,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        manager.setPositionInterval(seconds: seconds.intValue)
        resolve(nil)
    }

    @objc(silence:resolver:rejecter:)
    func silence(
        _ durationSeconds: NSNumber,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        manager.silence(durationSeconds: durationSeconds.intValue)
        resolve(nil)
    }

    @objc(reactivate:rejecter:)
    func reactivate(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        manager.reactivate()
        resolve(nil)
    }

    @objc(requestImmediatePosition:rejecter:)
    func requestImmediatePosition(
        _ resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        manager.requestImmediatePosition()
        resolve(nil)
    }

    // MARK: - Panic + last known position

    @objc(enqueuePanic:resolver:rejecter:)
    func enqueuePanic(
        _ payload: NSDictionary,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        let dictionary = payload as? [String: Any] ?? [:]
        let eventId = dictionary["event_id"] as? String ?? UUID().uuidString
        manager.enqueuePanic(payload: dictionary, eventId: eventId)
        resolve(nil)
    }

    @objc(getLastKnownPosition:rejecter:)
    func getLastKnownPosition(
        _ resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        resolve(manager.lastKnownPosition())
    }

    // MARK: - Event plumbing (required by NativeEventEmitter)

    @objc(addListener:)
    func addListener(_ eventName: String) {
        // No-op: the module owns a single native subscription (see init).
    }

    @objc(removeListeners:)
    func removeListeners(_ count: NSNumber) {
        // No-op: see addListener.
    }

    // MARK: - Helpers

    private func emitState() {
        guard isObserving else { return }
        sendEvent(withName: coreLogStateEvent, body: stateDictionary())
    }

    private func stateDictionary() -> [String: Any] {
        let snapshot = manager.state
        var dictionary: [String: Any] = [
            "trackingEnabled": snapshot.trackingEnabled,
            "pendingCount": snapshot.pendingCount,
            "intervalSeconds": snapshot.intervalSeconds,
        ]
        dictionary["lastSendAtUtc"] = snapshot.lastSendAtUtc ?? NSNull()
        dictionary["silencedUntilUtc"] = snapshot.silencedUntilUtc ?? NSNull()
        return dictionary
    }
}
