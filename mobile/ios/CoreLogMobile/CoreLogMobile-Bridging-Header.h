//
//  CoreLogMobile-Bridging-Header.h
//  CoreLogMobile
//
//  Exposes the React Native Objective-C headers to the Swift sources.
//  `SQLite3` is imported directly in Swift (`import SQLite3`), so only the RN
//  headers are needed here.
//
//  Xcode build setting: SWIFT_OBJC_BRIDGING_HEADER =
//  CoreLogMobile/CoreLogMobile-Bridging-Header.h
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTUtils.h>