//
//  CoreLogBackgroundServiceBridge.m
//  CoreLogMobile
//
//  Objective-C bridge exposing the Swift `CoreLogBackgroundService` class to
//  React Native as `NativeModules.CoreLogBackgroundService`.
//
//  Every method mirrors the Android `CoreLogBackgroundServiceModule` so the
//  JavaScript `BackgroundServiceBridge` is platform-agnostic.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (CoreLogBackgroundService, RCTEventEmitter)

RCT_EXTERN_METHOD(start
                  : (NSDictionary *)config resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getState
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setPositionInterval
                  : (nonnull NSNumber *)seconds resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(silence
                  : (nonnull NSNumber *)durationSeconds resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(reactivate
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestImmediatePosition
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(enqueuePanic
                  : (NSDictionary *)payload resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getLastKnownPosition
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(addListener : (NSString *)eventName)

RCT_EXTERN_METHOD(removeListeners : (nonnull NSNumber *)count)

@end
