/// <reference types="google.maps" />
import { MapPin, Search, Loader2, Navigation, X, Check, ArrowLeft } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { useLocation_ } from '@/contexts/LocationContext';
import { loadGoogleMapsScript } from '@/config/googleMaps';

interface LocationPickerDrawerProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'search' | 'map';

type SearchPrediction = {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  lat?: number;
  lng?: number;
  components?: google.maps.GeocoderAddressComponent[];
};

type LocationMeta = {
  cityName: string;
  areaName?: string;
  fullAddress: string;
};

/** Extract city/area from Google address_components */
const parseGeocodingComponents = (
  components: google.maps.GeocoderAddressComponent[]
): Pick<LocationMeta, 'cityName' | 'areaName'> => {
  const find = (...types: string[]) =>
    components.find((c) => types.some((t) => c.types.includes(t)))?.long_name;

  return {
    cityName:
      find('locality') ||
      find('administrative_area_level_2') ||
      find('administrative_area_level_1') ||
      'Unknown',
    areaName:
      find('sublocality_level_1') ||
      find('sublocality') ||
      find('neighborhood') ||
      find('route') ||
      undefined,
  };
};

/**
 * Reverse-geocode using Maps JavaScript API Geocoder (JS SDK).
 */
const reverseGeocodeJS = async (lat: number, lng: number): Promise<LocationMeta> => {
  await loadGoogleMapsScript();
  const geocoder = new google.maps.Geocoder();

  return new Promise((resolve) => {
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === google.maps.GeocoderStatus.OK && results && results.length > 0) {
        const preferred =
          results.find((r) =>
            r.types.includes('street_address') ||
            r.types.includes('premise') ||
            r.types.includes('subpremise')
          ) ||
          results.find((r) =>
            r.types.includes('route') ||
            r.types.includes('point_of_interest')
          ) ||
          results[0];

        const meta = parseGeocodingComponents(preferred.address_components);
        resolve({ ...meta, fullAddress: preferred.formatted_address });
      } else {
        console.warn('Geocoder failed:', status);
        resolve({
          cityName: 'Unknown',
          fullAddress: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        });
      }
    });
  });
};

const LocationPickerDrawer = ({ open, onClose }: LocationPickerDrawerProps) => {
  const { location, setLocation, requestGPSLocation, isLocating, locationError } = useLocation_();

  const [step, setStep] = useState<Step>('search');
  const [search, setSearch] = useState('');
  const [predictions, setPredictions] = useState<SearchPrediction[]>([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedLocationMeta, setSelectedLocationMeta] = useState<Pick<LocationMeta, 'cityName' | 'areaName'> | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isGeocodingAddress, setIsGeocodingAddress] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerInstance = useRef<google.maps.Marker | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  /** Reverse-geocode and update UI state */
  const reverseGeocodeAndUpdate = useCallback(async (lat: number, lng: number) => {
    setIsGeocodingAddress(true);
    setSelectedAddress('');
    try {
      const result = await reverseGeocodeJS(lat, lng);
      setSelectedAddress(result.fullAddress);
      setSelectedLocationMeta({ cityName: result.cityName, areaName: result.areaName });
      return result;
    } catch (err) {
      console.error('Reverse geocoding failed:', err);
      setSelectedAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      setSelectedLocationMeta({ cityName: 'Unknown' });
      return null;
    } finally {
      setIsGeocodingAddress(false);
    }
  }, []);

  // Load Google Maps JS SDK on open
  useEffect(() => {
    if (!open) return;
    loadGoogleMapsScript()
      .then(() => {
        setMapsLoaded(true);
        setMapsError(null);
        geocoderRef.current = new google.maps.Geocoder();
      })
      .catch(() => setMapsError('Failed to load Google Maps. Please check your API key.'));
  }, [open]);

  // Reset state when closed
  useEffect(() => {
    if (!open) {
      setStep('search');
      setSearch('');
      setPredictions([]);
      setSelectedAddress('');
      setSelectedCoords(null);
      setSelectedLocationMeta(null);
      setMapsError(null);
      setIsSearching(false);
      setIsGeocodingAddress(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // When location updates from GPS/flutter, go to map step
  useEffect(() => {
    if (!open || !location.lat || !location.lng) return;
    if (location.source !== 'gps' && location.source !== 'flutter') return;

    const coords = { lat: location.lat, lng: location.lng };
    setSelectedCoords(coords);
    setStep('map');
    void reverseGeocodeAndUpdate(coords.lat, coords.lng);
  }, [location, open, reverseGeocodeAndUpdate]);

  // Init map when switching to map step
  useEffect(() => {
    if (step !== 'map' || !mapsLoaded || !mapRef.current || !selectedCoords) return;

    const center = { lat: selectedCoords.lat, lng: selectedCoords.lng };

    if (mapInstance.current) {
      mapInstance.current.setCenter(center);
      markerInstance.current?.setPosition(center);
      return;
    }

    mapInstance.current = new google.maps.Map(mapRef.current, {
      center,
      zoom: 17,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    });

    markerInstance.current = new google.maps.Marker({
      position: center,
      map: mapInstance.current,
      draggable: true,
      animation: google.maps.Animation.DROP,
    });

    markerInstance.current.addListener('dragend', () => {
      const pos = markerInstance.current?.getPosition();
      if (!pos) return;
      const lat = pos.lat();
      const lng = pos.lng();
      setSelectedCoords({ lat, lng });
      void reverseGeocodeAndUpdate(lat, lng);
    });

    mapInstance.current.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      markerInstance.current?.setPosition(e.latLng);
      setSelectedCoords({ lat, lng });
      void reverseGeocodeAndUpdate(lat, lng);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mapsLoaded]);

  // When selectedCoords change on an existing map, re-center
  useEffect(() => {
    if (step !== 'map' || !mapInstance.current || !markerInstance.current || !selectedCoords) return;
    const pos = new google.maps.LatLng(selectedCoords.lat, selectedCoords.lng);
    mapInstance.current.setCenter(pos);
    markerInstance.current.setPosition(pos);
  }, [step, selectedCoords]);

  /** Live search using Geocoding API (forward geocode) — works with natural language */
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setPredictions([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    debounceRef.current = setTimeout(() => {
      if (!geocoderRef.current) {
        setIsSearching(false);
        return;
      }

      geocoderRef.current.geocode(
        {
          address: value,
          componentRestrictions: { country: 'IN' },
        },
        (results, status) => {
          setIsSearching(false);
          if (status === google.maps.GeocoderStatus.OK && results && results.length > 0) {
            setPredictions(
              results.slice(0, 8).map((r, i) => {
                const comps = r.address_components;
                const mainPart = comps[0]?.long_name || r.formatted_address.split(',')[0];
                const rest = r.formatted_address
                  .replace(mainPart + ', ', '')
                  .replace(mainPart, '');
                return {
                  id: `geo-${i}`,
                  title: mainPart,
                  subtitle: rest.replace(/^,\s*/, '') || undefined,
                  description: r.formatted_address,
                  lat: r.geometry.location.lat(),
                  lng: r.geometry.location.lng(),
                  components: r.address_components,
                };
              })
            );
            setMapsError(null);
          } else if (status === google.maps.GeocoderStatus.ZERO_RESULTS) {
            setPredictions([]);
          } else {
            console.warn('Geocoder forward status:', status);
            setPredictions([]);
          }
        }
      );
    }, 300);
  };

  /** When user selects a geocoded result, go to map */
  const handleSelectPrediction = (prediction: SearchPrediction) => {
    if (prediction.lat == null || prediction.lng == null) {
      setMapsError('Could not get coordinates for this location.');
      return;
    }

    const meta = prediction.components
      ? parseGeocodingComponents(prediction.components)
      : { cityName: 'Unknown', areaName: undefined };

    setSelectedCoords({ lat: prediction.lat, lng: prediction.lng });
    setSelectedAddress(prediction.description);
    setSelectedLocationMeta({ cityName: meta.cityName, areaName: meta.areaName });
    setIsGeocodingAddress(false);
    setStep('map');

    mapInstance.current = null;
    markerInstance.current = null;
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation && !window.flutter_inappwebview) return;

    requestGPSLocation();

    if (window.flutter_inappwebview) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setSelectedCoords({ lat: latitude, lng: longitude });
        setStep('map');
        mapInstance.current = null;
        markerInstance.current = null;
        void reverseGeocodeAndUpdate(latitude, longitude);
      },
      () => { /* error handled by context */ },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleConfirm = () => {
    if (!selectedCoords) return;

    setLocation({
      cityName: selectedLocationMeta?.cityName || 'Unknown',
      areaName: selectedLocationMeta?.areaName,
      lat: selectedCoords.lat,
      lng: selectedCoords.lng,
      source: 'manual',
      fullAddress: selectedAddress,
    });
    onClose();
  };

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} dismissible={false}>
      <DrawerContent
        className="max-h-[92vh] min-h-[60vh] flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DrawerTitle className="sr-only">Location picker</DrawerTitle>
        <DrawerDescription className="sr-only">
          Search for an address, landmark, or establishment, then confirm the exact pin on the map.
        </DrawerDescription>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-heading font-bold text-lg text-foreground">
            {step === 'search' ? 'Select Location' : 'Confirm Location'}
          </h2>
          <div className="flex items-center gap-2">
            {step === 'map' && (
              <button
                onClick={() => {
                  setStep('search');
                  mapInstance.current = null;
                  markerInstance.current = null;
                }}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-secondary active:scale-95 transition-transform"
                aria-label="Back to search"
              >
                <ArrowLeft size={18} className="text-muted-foreground" />
              </button>
            )}
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full flex items-center justify-center bg-secondary active:scale-95 transition-transform"
              aria-label="Close"
            >
              <X size={18} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        {mapsError && (
          <div className="mx-5 mb-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
            <p className="text-[13px] font-body text-destructive">{mapsError}</p>
          </div>
        )}

        {/* SEARCH STEP */}
        {step === 'search' && (
          <div className="flex-1 overflow-y-auto px-5 pb-6">
            {/* Search input */}
            <div className="flex items-center gap-2.5 bg-secondary border border-border rounded-2xl px-4 py-3 mb-4">
              <Search size={16} className="text-muted-foreground flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search for area, landmark, shop, street..."
                className="flex-1 bg-transparent text-[14px] font-body text-foreground placeholder:text-muted-foreground outline-none"
                autoFocus
              />
              {isSearching && <Loader2 size={14} className="text-muted-foreground animate-spin" />}
              {search && !isSearching && (
                <button onClick={() => { setSearch(''); setPredictions([]); }}>
                  <X size={14} className="text-muted-foreground" />
                </button>
              )}
            </div>

            {/* Use Current Location */}
            <button
              onClick={handleUseCurrentLocation}
              disabled={isLocating}
              className="w-full flex items-center gap-3 p-3.5 mb-4 rounded-2xl bg-primary/5 border border-primary/15 active:scale-[0.98] transition-transform min-h-[52px] disabled:opacity-60"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                {isLocating ? (
                  <Loader2 size={18} className="text-primary animate-spin" />
                ) : (
                  <Navigation size={18} className="text-primary" />
                )}
              </div>
              <div className="text-left">
                <span className="font-heading font-semibold text-[14px] text-primary block">
                  {isLocating ? 'Detecting location...' : 'Use Current Location'}
                </span>
                <span className="text-[11px] font-body text-muted-foreground">Using GPS</span>
              </div>
            </button>

            {locationError && (
              <p className="text-[12px] font-body text-destructive mb-3 px-1">{locationError}</p>
            )}

            {/* Live search results */}
            {predictions.length > 0 && (
              <div className="space-y-1">
                {predictions.map((pred) => (
                  <button
                    key={pred.id}
                    onClick={() => handleSelectPrediction(pred)}
                    className="w-full flex items-start gap-3 p-3.5 rounded-2xl bg-card border border-border active:scale-[0.98] transition-transform text-left"
                  >
                    <MapPin size={16} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-medium text-[14px] text-foreground truncate">
                        {pred.title}
                      </p>
                      <p className="text-[11px] font-body text-muted-foreground mt-0.5 truncate">
                        {pred.subtitle || pred.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {search && !isSearching && predictions.length === 0 && (
              <div className="text-center py-8">
                <MapPin size={32} className="text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-[13px] font-body text-muted-foreground">No results found</p>
              </div>
            )}

            {!search && predictions.length === 0 && (
              <div className="text-center py-8">
                <Search size={32} className="text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[13px] font-body text-muted-foreground">
                  Search for your location or use GPS
                </p>
              </div>
            )}
          </div>
        )}

        {/* MAP STEP */}
        {step === 'map' && (
          <div className="flex-1 flex flex-col px-5 pb-5">
            <div className="relative flex-1 min-h-[280px] rounded-2xl overflow-hidden border border-border mb-4">
              <div ref={mapRef} className="w-full h-full min-h-[280px]" data-vaul-no-drag />
              <div className="absolute top-3 left-3 right-3">
                <div className="bg-background/90 backdrop-blur-sm rounded-xl px-3 py-2 border border-border shadow-sm">
                  <p className="text-[11px] font-body text-muted-foreground text-center">
                    Drag the pin or tap to adjust location
                  </p>
                </div>
              </div>
            </div>

            {/* Selected address with loading state */}
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-secondary border border-border mb-4">
              <MapPin size={18} className="text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-heading font-medium text-[14px] text-foreground">
                  Selected Location
                </p>
                {isGeocodingAddress ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Loader2 size={12} className="text-muted-foreground animate-spin" />
                    <p className="text-[12px] font-body text-muted-foreground">
                      Fetching address...
                    </p>
                  </div>
                ) : (
                  <p className="text-[12px] font-body text-muted-foreground mt-0.5 leading-relaxed">
                    {selectedAddress || 'Tap on the map to select a location'}
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={handleConfirm}
              disabled={!selectedCoords || isGeocodingAddress}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary text-primary-foreground font-heading font-semibold text-[15px] active:scale-[0.98] transition-transform disabled:opacity-50 min-h-[52px] shadow-md"
            >
              <Check size={18} />
              Confirm Location
            </button>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
};

export default LocationPickerDrawer;
