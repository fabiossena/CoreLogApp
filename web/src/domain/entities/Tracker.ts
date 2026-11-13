/**
 * Domain entity: GPS trackers registered with CoreLog's admin API
 * (docs/api-contract.md, §4), including the per-type credential metadata
 * that drives the registration form.
 */

/** Tracker types accepted by `POST /api/trackers`. */
export type TrackerType = 'Sascar' | 'Omnilink' | 'Autotrac' | 'ChineseGPS' | 'MobileApp';

/** All supported tracker types, in display order. */
export const TRACKER_TYPES: TrackerType[] = [
  'Sascar',
  'Omnilink',
  'Autotrac',
  'ChineseGPS',
  'MobileApp',
];

/** Metadata of a single credential field for the registration form. */
export interface TrackerCredentialField {
  /** Snake_case key sent in the `credentials` object. */
  name: string;
  /** Human-readable English label. */
  label: string;
  /** Whether the backend requires this credential for the tracker type. */
  required: boolean;
  /** Input rendering hint. */
  input: 'text' | 'password';
}

/**
 * Credential fields per tracker type (docs/api-contract.md, §4). The
 * CommandCenter registration form is generated from this table, so adding a
 * credential here is enough to update the UI, the validation and the payload.
 */
export const TRACKER_CREDENTIAL_FIELDS: Record<TrackerType, TrackerCredentialField[]> = {
  Sascar: [
    { name: 'plate', label: 'Plate', required: true, input: 'text' },
    { name: 'integration_user', label: 'Integration user', required: true, input: 'text' },
    { name: 'password', label: 'Password', required: true, input: 'password' },
  ],
  Omnilink: [
    { name: 'external_fleet_id', label: 'External fleet id', required: true, input: 'text' },
    { name: 'wstt_user', label: 'WSTT user', required: true, input: 'text' },
    { name: 'wstt_password', label: 'WSTT password', required: true, input: 'password' },
  ],
  Autotrac: [
    { name: 'fleet_id', label: 'Fleet id', required: true, input: 'text' },
    { name: 'api_key', label: 'API key', required: true, input: 'password' },
  ],
  ChineseGPS: [
    { name: 'traccar_device_id', label: 'Traccar device id', required: true, input: 'text' },
    { name: 'chip_model', label: 'Chip model', required: true, input: 'text' },
  ],
  MobileApp: [
    { name: 'fcm_sender_id', label: 'FCM sender id (optional)', required: false, input: 'text' },
  ],
};

/** A registered tracker (`GET /api/trackers`). */
export interface Tracker {
  tracker_id: string;
  type: TrackerType;
  name: string;
  vehicle_id: string;
  polling_interval_seconds: number;
  credentials: Record<string, string>;
  enabled: boolean;
  created_at_utc: string;
}

/** Body of `POST /api/trackers`. */
export interface RegisterTrackerRequest {
  type: TrackerType;
  name: string;
  vehicle_id: string;
  polling_interval_seconds: number;
  credentials: Record<string, string>;
  enabled: boolean;
}

/** Response of `POST /api/trackers` (`201 Created`). */
export interface RegisterTrackerResponse {
  tracker_id: string;
  type: TrackerType;
  vehicle_id: string;
}

/** Response of `GET /api/trackers`. */
export interface TrackerListResponse {
  items: Tracker[];
}

/**
 * Validates the required credentials of a tracker type.
 *
 * @param type - Tracker type being registered.
 * @param credentials - Credentials collected by the form.
 * @returns English labels of the missing required fields (empty when valid).
 */
export function validateTrackerCredentials(
  type: TrackerType,
  credentials: Record<string, string>,
): string[] {
  return TRACKER_CREDENTIAL_FIELDS[type]
    .filter((field) => field.required && (credentials[field.name] ?? '').trim() === '')
    .map((field) => field.label);
}
