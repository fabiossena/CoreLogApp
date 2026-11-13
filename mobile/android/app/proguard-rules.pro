# Project-specific R8/ProGuard rules.
#
# React Native ships consumer rules in its AARs, but the reflection-heavy
# bridges and the native modules below need explicit keeps so release builds
# behave exactly like debug builds.

# --- React Native (bridges, JNI, Hermes) ------------------------------------
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters

-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.proguard.annotations.KeepGettersAndSetters *;
}

-keepclasseswithmembernames class * {
    native <methods>;
}

-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.react.**

# --- React Native Firebase ---------------------------------------------------
-keep class io.invertase.firebase.** { *; }
-dontwarn io.invertase.firebase.**

# --- react-native-sqlite-storage --------------------------------------------
-keep class org.pgsqlite.** { *; }

# --- CoreLog native background service --------------------------------------
-keep class com.corelog.mobile.background.** { *; }
