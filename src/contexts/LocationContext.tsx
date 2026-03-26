import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export interface LocationData {
  cityName: string;
  areaName?: string;
  lat?: number;
  lng?: number;
  source: 'manual' | 'gps' | 'flutter';
}

interface LocationContextType {
  location: LocationData;
  setLocation: (loc: LocationData) => void;
  requestGPSLocation: () => void;
  isLocating: boolean;
  locationError: string | null;
}

const DEFAULT_LOCATION: LocationData = {
  cityName: 'Bangalore',
  areaName: undefined,
  lat: undefined,
  lng: undefined,
  source: 'manual',
};

const LocationContext = createContext<LocationContextType>({
  location: DEFAULT_LOCATION,
  setLocation: () => {},
  requestGPSLocation: () => {},
  isLocating: false,
  locationError: null,
});

export const useLocation_ = () => useContext(LocationContext);

// Reverse geocode coords → city name using free Nominatim API
async function reverseGeocode(lat: number, lng: number): Promise<{ city: string; area?: string }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    const addr = data.address || {};
    const city =
      addr.city || addr.town || addr.village || addr.state_district || addr.state || 'Unknown';
    const area = addr.suburb || addr.neighbourhood || addr.county || undefined;
    return { city, area };
  } catch {
    return { city: 'Unknown' };
  }
}

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const [location, setLocationState] = useState<LocationData>(() => {
    try {
      const stored = localStorage.getItem('user_location');
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return DEFAULT_LOCATION;
  });
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('user_location', JSON.stringify(location));
  }, [location]);

  const setLocation = useCallback((loc: LocationData) => {
    setLocationState(loc);
    setLocationError(null);
  }, []);

  // Browser Geolocation API fallback
  const requestGPSLocation = useCallback(() => {
    setIsLocating(true);
    setLocationError(null);

    // Check if Flutter bridge provides native location
    if (window.flutter_inappwebview) {
      try {
        window.flutter_inappwebview.callHandler('requestLocation');
        // Flutter will call window.setLocationFromNative() with the result
        // Timeout fallback if Flutter doesn't respond
        setTimeout(() => setIsLocating(false), 10000);
        return;
      } catch { /* fall through to browser API */ }
    }

    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser');
      setIsLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const geo = await reverseGeocode(latitude, longitude);
        setLocation({
          cityName: geo.city,
          areaName: geo.area,
          lat: latitude,
          lng: longitude,
          source: 'gps',
        });
        setIsLocating(false);
      },
      (err) => {
        const messages: Record<number, string> = {
          1: 'Location permission denied. Please enable it in your settings.',
          2: 'Unable to determine your location. Please try again.',
          3: 'Location request timed out. Please try again.',
        };
        setLocationError(messages[err.code] || 'Failed to get location');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, [setLocation]);

  // Expose global setter for Flutter bridge
  useEffect(() => {
    (window as any).setLocationFromNative = (data: {
      lat: number;
      lng: number;
      city?: string;
      area?: string;
    }) => {
      if (data.city) {
        setLocation({
          cityName: data.city,
          areaName: data.area,
          lat: data.lat,
          lng: data.lng,
          source: 'flutter',
        });
        setIsLocating(false);
      } else {
        // Flutter sent coords only — reverse geocode on web side
        reverseGeocode(data.lat, data.lng).then((geo) => {
          setLocation({
            cityName: geo.city,
            areaName: geo.area,
            lat: data.lat,
            lng: data.lng,
            source: 'flutter',
          });
          setIsLocating(false);
        });
      }
    };

    // Also expose error handler
    (window as any).setLocationError = (msg: string) => {
      setLocationError(msg);
      setIsLocating(false);
    };

    return () => {
      delete (window as any).setLocationFromNative;
      delete (window as any).setLocationError;
    };
  }, [setLocation]);

  return (
    <LocationContext.Provider
      value={{ location, setLocation, requestGPSLocation, isLocating, locationError }}
    >
      {children}
    </LocationContext.Provider>
  );
};
