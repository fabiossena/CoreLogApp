/**
 * Application composition root.
 *
 * The only place where the layers meet: it instantiates the infrastructure
 * (`CoreLogApiClient`, `BackgroundServiceBridge`, `FcmCommandReceiver`,
 * `InstallationTracker`, SQLite), the data repositories, the domain use
 * cases and the `HomeViewModel`, then hands the ViewModel to the view.
 *
 * This is where Dependency Inversion is realized: ports declared by the
 * domain/presentation layers are bound to their concrete implementations.
 */
import React, {useEffect, useMemo} from 'react';
import {AppEnv, AppEnvOverrides, loadAppEnv} from './config/env';
import {DEV_ENV_OVERRIDES} from './config/dev';
import {PRODUCTION_ENV_OVERRIDES} from './config/production';
import {StartTrackingUseCase} from './domain/usecases/StartTrackingUseCase';
import {StopTrackingUseCase} from './domain/usecases/StopTrackingUseCase';
import {
  ImmediatePositionReporter,
  HandleRemoteCommandUseCase,
} from './domain/usecases/HandleRemoteCommandUseCase';
import {
  PanicTransport,
  SendPanicUseCase,
} from './domain/usecases/SendPanicUseCase';
import {CommandRepository} from './data/repositories/CommandRepository';
import {LocationRepository} from './data/repositories/LocationRepository';
import {createNativeSqliteExecutor} from './data/local/PositionBuffer';
import {
  CoreLogApiClient,
  toPanicRequestDto,
} from './infrastructure/http/CoreLogApiClient';
import {BackgroundServiceBridge} from './infrastructure/background/BackgroundServiceBridge';
import {
  FcmCommandReceiver,
  registerFcmBackgroundHandler,
} from './infrastructure/push/FcmCommandReceiver';
import {
  createFirebaseAnalyticsPort,
  InstallationTracker,
} from './infrastructure/analytics/InstallationTracker';
import {HomeViewModel} from './presentation/viewmodels/HomeViewModel';
import {HomeScreen} from './presentation/screens/HomeScreen';

/** Options of {@link createAppComposition}. */
export interface CreateAppCompositionOptions {
  /** Overrides merged over `process.env` (tests, native config bridges). */
  envOverrides?: AppEnvOverrides;
}

/** Fully wired application object (useful for tests and background handlers). */
export interface AppComposition {
  /** Resolved configuration. */
  env: AppEnv;
  /** HTTP client. */
  api: CoreLogApiClient;
  /** Bridge to the native background service. */
  bridge: BackgroundServiceBridge;
  /** JS-side offline buffer repository. */
  locationRepository: LocationRepository;
  /** Remote-command use case (also used by the FCM background handler). */
  handleCommand: HandleRemoteCommandUseCase;
  /** FCM data-message receiver. */
  receiver: FcmCommandReceiver;
  /** Installation/uninstall analytics. */
  installTracker: InstallationTracker;
  /** MVVM view model bound to `HomeScreen`. */
  viewModel: HomeViewModel;
  /** Tears down subscriptions. */
  dispose(): void;
}

/**
 * Wires all layers together.
 *
 * @param options - optional environment overrides.
 * @returns the assembled {@link AppComposition}.
 */
export function createAppComposition(
  options: CreateAppCompositionOptions = {},
): AppComposition {
  const env = loadAppEnv(options.envOverrides ?? {});

  // --- infrastructure -----------------------------------------------------
  const api = new CoreLogApiClient({baseUrl: env.coreLogBaseUrl});
  const bridge = new BackgroundServiceBridge({env});

  // --- data ---------------------------------------------------------------
  const locationRepository = new LocationRepository({
    sender: api,
    executor: createNativeSqliteExecutor(),
    batchSize: env.batchSize,
  });
  const commandRepository = new CommandRepository(api);

  // --- domain -------------------------------------------------------------
  const startTracking = new StartTrackingUseCase(bridge, env.positionIntervalSeconds);
  const stopTracking = new StopTrackingUseCase(bridge);

  const panicTransport: PanicTransport = {
    async sendPanic(event) {
      await api.sendPanic(toPanicRequestDto(event));
    },
  };
  const sendPanic = new SendPanicUseCase({
    transport: panicTransport,
    queue: bridge,
    positionSource: bridge,
  });

  // Fast path: while tracking is OFF, deliver the last known fix straight
  // from JavaScript instead of spinning up the native service.
  const immediatePositionReporter: ImmediatePositionReporter = {
    async reportIfAvailable(): Promise<boolean> {
      if (bridge.isTrackingEnabled()) {
        return false; // the running service delivers a fresh fix itself
      }
      const position = await bridge.getLastKnownPosition();
      if (!position) {
        return false;
      }
      await locationRepository.enqueuePosition(position);
      const sent = await locationRepository.flush();
      return sent > 0;
    },
  };

  const handleCommand = new HandleRemoteCommandUseCase(bridge, commandRepository, {
    immediatePositionReporter,
    onError: (error, command) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[CoreLog] command ${command.commandType} (${command.commandId}) failed:`,
        error,
      );
    },
  });

  // --- presentation -------------------------------------------------------
  const viewModel = new HomeViewModel({
    startTracking,
    stopTracking,
    sendPanic,
    stateSource: bridge,
    localBuffer: locationRepository,
    vehicleId: env.vehicleId,
  });

  const receiver = new FcmCommandReceiver({handleCommand});
  const installTracker = new InstallationTracker({analytics: createFirebaseAnalyticsPort()});

  return {
    env,
    api,
    bridge,
    locationRepository,
    handleCommand,
    receiver,
    installTracker,
    viewModel,
    dispose() {
      receiver.stopForegroundListening();
      bridge.dispose();
      api.dispose();
      viewModel.dispose();
    },
  };
}

let sharedComposition: AppComposition | null = null;

/**
 * Returns the process-wide composition (created on first use).
 *
 * @returns the shared {@link AppComposition}.
 */
export function getSharedComposition(): AppComposition {
  if (!sharedComposition) {
    sharedComposition = createAppComposition({
      envOverrides: __DEV__ ? DEV_ENV_OVERRIDES : PRODUCTION_ENV_OVERRIDES,
    });
  }
  return sharedComposition;
}

/**
 * Registers the FCM **background** message handler. Called from `index.js`
 * at module scope so the headless JS runtime processes commands while the
 * app is closed.
 *
 * @returns `true` when the handler was installed.
 */
export function registerBackgroundCommandHandler(): boolean {
  const composition = getSharedComposition();
  return registerFcmBackgroundHandler(composition.handleCommand, error => {
    // eslint-disable-next-line no-console
    console.warn('[CoreLog] background command failed:', error);
  });
}

/**
 * Root React component: keeps the composition alive for the app lifetime and
 * renders the home view.
 */
function App(): React.ReactElement {
  const composition = useMemo(() => getSharedComposition(), []);

  useEffect(() => {
    void composition.viewModel.initialize();
    const unsubscribe = composition.receiver.startForegroundListening();
    void composition.installTracker.trackInstall();
    return () => {
      unsubscribe();
      composition.dispose();
    };
  }, [composition]);

  return <HomeScreen viewModel={composition.viewModel} />;
}

export default App;
