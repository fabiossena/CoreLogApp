package com.corelog.mobile.background

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers [CoreLogBackgroundServiceModule] with React Native (autolinking
 * does not cover in-app native modules, so `MainApplication` adds this
 * package manually).
 */
class CoreLogBackgroundServicePackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(CoreLogBackgroundServiceModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = emptyList()
}
