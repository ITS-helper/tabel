const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");

const PACKAGE_DIR = path.join("app", "src", "main", "java", "com", "workwatch", "blemap");

const moduleKt = `package com.workwatch.blemap

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap

class NfcPassModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext),
  NfcAdapter.ReaderCallback,
  LifecycleEventListener {

  private var pendingPromise: Promise? = null

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = "NfcPass"

  @ReactMethod
  fun isSupported(promise: Promise) {
    promise.resolve(NfcAdapter.getDefaultAdapter(reactContext) != null)
  }

  @ReactMethod
  fun isEnabled(promise: Promise) {
    val adapter = NfcAdapter.getDefaultAdapter(reactContext)
    promise.resolve(adapter?.isEnabled == true)
  }

  @ReactMethod
  fun scanPass(promise: Promise) {
    val activity = reactContext.currentActivity
    val adapter = NfcAdapter.getDefaultAdapter(reactContext)

    if (activity == null) {
      promise.reject("ACTIVITY_UNAVAILABLE", "Activity is unavailable")
      return
    }
    if (adapter == null) {
      promise.reject("NFC_UNAVAILABLE", "NFC is unavailable")
      return
    }
    if (!adapter.isEnabled) {
      promise.reject("NFC_DISABLED", "NFC is disabled")
      return
    }
    if (pendingPromise != null) {
      promise.reject("NFC_BUSY", "NFC scan is already active")
      return
    }

    pendingPromise = promise
    try {
      val flags =
        NfcAdapter.FLAG_READER_NFC_A or
          NfcAdapter.FLAG_READER_NFC_B or
          NfcAdapter.FLAG_READER_NFC_F or
          NfcAdapter.FLAG_READER_NFC_V or
          NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or
          NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
      adapter.enableReaderMode(activity, this, flags, null)
    } catch (e: Exception) {
      pendingPromise = null
      promise.reject("NFC_START_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun cancelScan(promise: Promise) {
    stopReaderMode(reactContext.currentActivity)
    pendingPromise?.reject("NFC_CANCELLED", "NFC scan cancelled")
    pendingPromise = null
    promise.resolve(true)
  }

  override fun onTagDiscovered(tag: Tag) {
    val promise = pendingPromise ?: return
    val id = tag.id ?: ByteArray(0)
    val map = Arguments.createMap()
    map.putString("uid", id.toHex())
    map.putString("uidReversed", id.reversedArray().toHex())
    map.putArray("bytes", Arguments.createArray().apply {
      id.forEach { pushInt(it.toInt() and 0xff) }
    })
    map.putArray("techs", Arguments.createArray().apply {
      tag.techList.forEach { pushString(it) }
    })

    resolveScan(promise, map)
  }

  override fun onHostResume() = Unit

  override fun onHostPause() {
    stopReaderMode(reactContext.currentActivity)
  }

  override fun onHostDestroy() {
    stopReaderMode(reactContext.currentActivity)
    pendingPromise = null
  }

  private fun resolveScan(promise: Promise, map: WritableMap) {
    UiThreadUtil.runOnUiThread {
      stopReaderMode(reactContext.currentActivity)
      pendingPromise = null
      promise.resolve(map)
    }
  }

  private fun stopReaderMode(activity: Activity?) {
    val adapter = NfcAdapter.getDefaultAdapter(reactContext) ?: return
    if (activity == null) return
    try {
      adapter.disableReaderMode(activity)
    } catch (_: Exception) {
    }
  }

  private fun ByteArray.toHex(): String =
    joinToString(separator = "") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
      .uppercase()
}
`;

const packageKt = `package com.workwatch.blemap

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class NfcPassPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(NfcPassModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
`;

function patchMainApplication(file) {
  let source = fs.readFileSync(file, "utf8");
  if (!source.includes("add(NfcPassPackage())")) {
    source = source.replace(
      "// add(MyReactNativePackage())",
      "add(NfcPassPackage())",
    );
    fs.writeFileSync(file, source);
  }
}

module.exports = function withNfcPass(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    if (
      !manifest["uses-permission"].some(
        (p) => p.$?.["android:name"] === "android.permission.NFC",
      )
    ) {
      manifest["uses-permission"].push({
        $: { "android:name": "android.permission.NFC" },
      });
    }

    manifest["uses-feature"] = manifest["uses-feature"] || [];
    const existingFeature = manifest["uses-feature"].find(
      (f) => f.$?.["android:name"] === "android.hardware.nfc",
    );
    if (existingFeature) {
      existingFeature.$["android:required"] = "false";
    } else {
      manifest["uses-feature"].push({
        $: {
          "android:name": "android.hardware.nfc",
          "android:required": "false",
        },
      });
    }
    return mod;
  });

  return withDangerousMod(config, [
    "android",
    (mod) => {
      const packageDir = path.join(mod.modRequest.platformProjectRoot, PACKAGE_DIR);
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, "NfcPassModule.kt"), moduleKt);
      fs.writeFileSync(path.join(packageDir, "NfcPassPackage.kt"), packageKt);
      patchMainApplication(path.join(packageDir, "MainApplication.kt"));
      return mod;
    },
  ]);
};
