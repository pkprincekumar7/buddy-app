import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
internal import ExpoModulesCore
internal import Expo

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Initialise Expo modules before React Native starts.
    let _ = super.application(application, didFinishLaunchingWithOptions: launchOptions)

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    self.window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "BuddyApp",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
