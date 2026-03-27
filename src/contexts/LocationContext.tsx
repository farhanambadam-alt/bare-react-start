import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export interface LocationData {
  cityName: string;
  areaName?: string;
  lat?: number;
  lng?: number;
  source: 'manual' | 'gps' | 'flutter';
  fullAddress?: string;
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

async function reverseGeocode(lat: number, lng: number): Promise<{ city: string; area?: string; fullAddress?: string }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    const addr = data.address || {};
    const city =
      addr.city || addr.town || addr.village || addr.municipality || addr.state_district || addr.state || 'Unknown';
    const area = addr.suburb || addr.neighbourhood || addr.city_district || addr.county || undefined;
    return {
      city,
      area,
      fullAddress: data.display_name || undefined,
    };
  } catch {
    return { city: 'Unknown' };
  }
}

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const [location, setLocationState] = useState<LocationData>(() => {
    try {
      const stored = localStorage.getItem('user_location');
      if (stored) return JSON.parse(stored);
    } catch {
      /* ignore */
    }
    return DEFAULT_LOCATION;
  });
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('user_location', JSON.stringify(location));
  }, [location]);

  const setLocation = useCallback((loc: LocationData) => {
    setLocationState(loc);
    setLocationError(null);
  }, []);

  const requestGPSLocation = useCallback(() => {
    setIsLocating(true);
    setLocationError(null);

    if (window.flutter_inappwebview) {
      try {
        window.flutter_inappwebview.callHandler('requestLocation');
        setTimeout(() => setIsLocating(false), 10000);
        return;
      } catch {
        /* fall through to browser API */
      }
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
          fullAddress: geo.fullAddress,
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

  useEffect(() => {
    (window as any).setLocationFromNative = (data: {
      lat: number;
      lng: number;
      city?: string;
      area?: string;
      fullAddress?: string;
    }) => {
      if (data.city) {
        setLocation({
          cityName: data.city,
          areaName: data.area,
          lat: data.lat,
          lng: data.lng,
          source: 'flutter',
          fullAddress: data.fullAddress,
        });
        setIsLocating(false);
      } else {
        reverseGeocode(data.lat, data.lng).then((geo) => {
          setLocation({
            cityName: geo.city,
            areaName: geo.area,
            lat: data.lat,
            lng: data.lng,
            source: 'flutter',
            fullAddress: geo.fullAddress,
          });
          setIsLocating(false);
        });
      }
    };

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
