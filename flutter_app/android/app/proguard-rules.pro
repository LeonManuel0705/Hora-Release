# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

# Flutter's Gradle plugin hands this file to R8 for release builds.
#
# flutter_local_notifications keeps scheduled reminders as JSON through Gson and reads them
# back with TypeToken subclasses. R8 in full mode drops their generic signatures, after which
# every planned reminder fails with "Missing type parameter" and the alarm receiver crashes.
# The plugin's README asks apps to add Gson's own rules; these are the ones Gson publishes
# for Android (examples/android-proguard-example), as its 2.8.9 jar ships none.

-keepattributes Signature
-keepattributes *Annotation*
-dontwarn sun.misc.**

-keep class * extends com.google.gson.TypeAdapter
-keep class * implements com.google.gson.TypeAdapterFactory
-keep class * implements com.google.gson.JsonSerializer
-keep class * implements com.google.gson.JsonDeserializer

-keepclassmembers,allowobfuscation class * {
  @com.google.gson.annotations.SerializedName <fields>;
}

-keep,allowobfuscation,allowshrinking class com.google.gson.reflect.TypeToken
-keep,allowobfuscation,allowshrinking class * extends com.google.gson.reflect.TypeToken
