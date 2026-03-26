# Cursor AI Prompt — Native Location for ChicSalon Flutter WebView

> **Copy-paste this entire prompt into Cursor AI to add native location to the Flutter project.**

---

## OVERVIEW

Add native GPS location support to the existing ChicSalon Flutter WebView shell. The web app requests location via a JavaScript bridge, Flutter obtains native GPS coordinates (with proper permissions), and sends the result back to the web app via JS evaluation.

---

## DEPENDENCIES TO ADD (pubspec.yaml)

```yaml
dependencies:
  geolocator: ^13.0.2
  geocoding: ^3.0.0
  permission_handler: ^11.3.1
```

---

## PLATFORM CONFIGURATION

### Android

**android/app/src/main/AndroidManifest.xml** — Add these permissions BEFORE the <application> tag:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

**android/app/build.gradle** — Ensure `compileSdkVersion` is at least 34.

### iOS

**ios/Runner/Info.plist** — Add these keys inside <dict>:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>ChicSalon needs your location to find nearby salons</string>
<key>NSLocationAlwaysUsageDescription</key>
<string>ChicSalon needs your location to find nearby salons</string>
```

---

## IMPLEMENTATION

### 1. Register the `requestLocation` JavaScript Handler

In `main.dart`, inside `onWebViewCreated`, add this handler alongside the existing `routeChanged` handler:

```dart
onWebViewCreated: (controller) {
  _controller = controller;

  // Existing route handler
  controller.addJavaScriptHandler(
    handlerName: 'routeChanged',
    callback: (args) {
      final String path = args.isNotEmpty ? args[0].toString() : '/';
      debugPrint('Web route changed: $path');
    },
  );

  // NEW: Location request handler
  controller.addJavaScriptHandler(
    handlerName: 'requestLocation',
    callback: (args) {
      _handleLocationRequest();
      return null;
    },
  );
},
```

### 2. Add the Location Handler Method

Add this method to `_WebViewScreenState`:

```dart
Future<void> _handleLocationRequest() async {
  try {
    // 1. Check if location services are enabled
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      _sendLocationError('Location services are disabled. Please enable GPS.');
      return;
    }

    // 2. Check & request permission
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        _sendLocationError('Location permission denied.');
        return;
      }
    }

    if (permission == LocationPermission.deniedForever) {
      _sendLocationError('Location permission permanently denied. Please enable it in Settings.');
      return;
    }

    // 3. Get current position
    Position position = await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
      timeLimit: const Duration(seconds: 15),
    );

    // 4. Reverse geocode to get city name
    String? cityName;
    String? areaName;
    try {
      List<Placemark> placemarks = await placemarkFromCoordinates(
        position.latitude,
        position.longitude,
      );
      if (placemarks.isNotEmpty) {
        final place = placemarks.first;
        cityName = place.locality ?? place.subAdministrativeArea ?? place.administrativeArea;
        areaName = place.subLocality ?? place.thoroughfare;
      }
    } catch (e) {
      debugPrint('Geocoding failed: $e');
    }

    // 5. Send result to web app
    final js = '''
      if (window.setLocationFromNative) {
        window.setLocationFromNative({
          lat: ${position.latitude},
          lng: ${position.longitude},
          city: ${cityName != null ? '"$cityName"' : 'null'},
          area: ${areaName != null ? '"$areaName"' : 'null'}
        });
      }
    ''';
    await _controller?.evaluateJavascript(source: js);

  } catch (e) {
    debugPrint('Location error: $e');
    _sendLocationError('Failed to get location. Please try again.');
  }
}

void _sendLocationError(String message) {
  final js = '''
    if (window.setLocationError) {
      window.setLocationError("$message");
    }
  ''';
  _controller?.evaluateJavascript(source: js);
}
```

### 3. Add Required Imports

At the top of `main.dart`:

```dart
import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';
```

---

## HOW THE BRIDGE WORKS

```
┌──────────────────────────────────────────────┐
│              WEB APP (React)                 │
│                                              │
│  User taps "Use Current Location"            │
│  → LocationContext calls:                    │
│    flutter_inappwebview.callHandler(         │
│      'requestLocation'                       │
│    )                                         │
│                                              │
│  Waits for callback on:                      │
│    window.setLocationFromNative({            │
│      lat, lng, city?, area?                  │
│    })                                        │
│  OR                                          │
│    window.setLocationError("message")        │
├──────────────────────────────────────────────┤
│              FLUTTER SHELL                   │
│                                              │
│  Receives 'requestLocation' handler call     │
│  → Checks permissions (Geolocator)           │
│  → Gets GPS coordinates                      │
│  → Reverse geocodes to city name             │
│  → Calls evaluateJavascript() to send        │
│    result back to web app                    │
└──────────────────────────────────────────────┘
```

---

## FALLBACK BEHAVIOR

- **In browser (no Flutter):** The web app automatically falls back to the browser's `navigator.geolocation` API
- **Flutter geocoding fails:** The web app receives coordinates without city name and reverse geocodes on its own using Nominatim
- **Permission denied:** Error message shown in the Location Picker drawer

---

## TESTING CHECKLIST

- [ ] "Use Current Location" in the web app triggers native GPS on Android
- [ ] "Use Current Location" in the web app triggers native GPS on iOS
- [ ] Permission dialog appears on first request (both platforms)
- [ ] City name is correctly resolved and shown in the header
- [ ] Denied permission shows appropriate error message in the drawer
- [ ] Location persists across app restarts (web app stores in localStorage)
- [ ] When running in browser (not Flutter), browser geolocation API works as fallback
- [ ] Back button / navigation still works correctly after location request

---

## CRITICAL RULES

1. **DO NOT** request location on app startup — only when user taps "Use Current Location"
2. **DO NOT** request `ACCESS_BACKGROUND_LOCATION` — only foreground access is needed
3. **DO NOT** add any Flutter UI for location — all UI is in the web app
4. The handler must be registered in `onWebViewCreated`, NOT in `onLoadStop`
5. Always handle the case where geocoding fails — send coordinates without city name
