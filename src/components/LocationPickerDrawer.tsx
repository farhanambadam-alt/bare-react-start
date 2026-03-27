/// <reference types="google.maps" />
import { MapPin, Search, Loader2, Navigation, X, Check, ArrowLeft } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { useLocation_ } from '@/contexts/LocationContext';
import { loadGoogleMapsScript, GOOGLE_MAPS_API_KEY } from '@/config/googleMaps';

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
  placeId?: string;
  lat?: number;
  lng?: number;
  cityName?: string;
  areaName?: string;
};

type LocationMeta = {
  cityName: string;
  areaName?: string;
  fullAddress: string;
};

/** Extract city/area from Google Geocoding address_components */
const parseGeocodingComponents = (
  components: Array<{ long_name: string; short_name: string; types: string[] }>
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

/** Reverse-geocode using Maps JavaScript API Geocoder */
const reverseGeocodeGoogle = async (lat: number, lng: number): Promise<LocationMeta> => {
  try {
    await loadGoogleMapsScript();
    const geocoder = new google.maps.Geocoder();
    const response = await geocoder.geocode({ location: { lat, lng } });

    if (response.results?.length) {
      const preferred =
        response.results.find((r) =>
          r.types.includes('street_address') ||
          r.types.includes('premise') ||
          r.types.includes('subpremise') ||
          r.types.includes('point_of_interest')
        ) || response.results[0];

      const meta = parseGeocodingComponents(
        preferred.address_components.map((c) => ({
          long_name: c.long_name,
          short_name: c.short_name,
          types: c.types,
        }))
      );
      return { ...meta, fullAddress: preferred.formatted_address };
    }
    return { cityName: 'Unknown', fullAddress: `${lat.toFixed(6)}, ${lng.toFixed(6)}` };
  } catch {
    return { cityName: 'Unknown', fullAddress: `${lat.toFixed(6)}, ${lng.toFixed(6)}` };
  }
};

/** Search using Maps JavaScript API AutocompleteService (old Places API) */
const searchPlacesOld = async (
  query: string,
): Promise<SearchPrediction[]> => {
  await loadGoogleMapsScript();
  const service = new google.maps.places.AutocompleteService();

  return new Promise((resolve) => {
    service.getPlacePredictions(
      { input: query, componentRestrictions: { country: 'in' } },
      (predictions, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
          resolve([]);
          return;
        }
        resolve(
          predictions.map((p) => ({
            id: p.place_id,
            title: p.structured_formatting.main_text,
            subtitle: p.structured_formatting.secondary_text,
            description: p.description,
            placeId: p.place_id,
          }))
        );
      }
    );
  });
};

/** Get place details (lat/lng + address components) from a place_id */
const getPlaceDetails = async (placeId: string): Promise<{ lat: number; lng: number; meta: LocationMeta } | null> => {
  await loadGoogleMapsScript();
  const div = document.createElement('div');
  const placesService = new google.maps.places.PlacesService(div);

  return new Promise((resolve) => {
    placesService.getDetails(
      { placeId, fields: ['geometry', 'formatted_address', 'address_components'] },
      (place, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !place?.geometry?.location) {
          resolve(null);
          return;
        }
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        const components = (place.address_components || []).map((c) => ({
          long_name: c.long_name,
          short_name: c.short_name,
          types: c.types,
        }));
        const parsed = parseGeocodingComponents(components);
        resolve({
          lat,
          lng,
          meta: { ...parsed, fullAddress: place.formatted_address || '' },
        });
      }
    );
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

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerInstance = useRef<google.maps.Marker | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const searchAbortRef = useRef<AbortController | null>(null);

  const setResolvedSelection = useCallback((coords: { lat: number; lng: number }, meta: LocationMeta) => {
    setSelectedCoords(coords);
    setSelectedAddress(meta.fullAddress);
    setSelectedLocationMeta({ cityName: meta.cityName, areaName: meta.areaName });
    setStep('map');
  }, []);

  const reverseGeocodeCoords = useCallback(async (lat: number, lng: number) => {
    try {
      const result = await reverseGeocodeGoogle(lat, lng);
      setSelectedAddress(result.fullAddress);
      setSelectedLocationMeta({ cityName: result.cityName, areaName: result.areaName });
      return result;
    } catch (err) {
      console.error('Reverse geocoding failed:', err);
      setSelectedAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      setSelectedLocationMeta({ cityName: 'Unknown' });
      return null;
    }
  }, []);

  // Load Google Maps JS on open (for the interactive map only)
  useEffect(() => {
    if (!open) return;
    loadGoogleMapsScript()
      .then(() => {
        setMapsLoaded(true);
        setMapsError(null);
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
      searchAbortRef.current?.abort();
    }
  }, [open]);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // When location updates from GPS/flutter, show map
  useEffect(() => {
    if (!open || !location.lat || !location.lng) return;
    if (location.source !== 'gps' && location.source !== 'flutter') return;

    setSelectedCoords({ lat: location.lat, lng: location.lng });
    setSelectedAddress(location.fullAddress || [location.areaName, location.cityName].filter(Boolean).join(', '));
    setSelectedLocationMeta({ cityName: location.cityName, areaName: location.areaName });
    setStep('map');
  }, [location, open]);

  // Init map when switching to map step
  useEffect(() => {
    if (step !== 'map' || !mapsLoaded || !mapRef.current || !selectedCoords) return;

    const center = { lat: selectedCoords.lat, lng: selectedCoords.lng };

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
      void reverseGeocodeCoords(lat, lng);
    });

    mapInstance.current.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      markerInstance.current?.setPosition(e.latLng);
      setSelectedCoords({ lat, lng });
      void reverseGeocodeCoords(lat, lng);
    });
  }, [step, mapsLoaded, selectedCoords?.lat, selectedCoords?.lng, reverseGeocodeCoords]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      searchAbortRef.current?.abort();
      setPredictions([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    debounceRef.current = setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      try {
        const results = await searchPlacesOld(value);
        setPredictions(results);
        setMapsError(null);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Places search error:', err);
          setMapsError(err.message || 'Search failed. Please try again.');
          setPredictions([]);
        }
      } finally {
        setIsSearching(false);
      }
    }, 350);
  };

  const handleSelectPrediction = async (prediction: SearchPrediction) => {
    if (!prediction.placeId) {
      setMapsError('Could not get coordinates for this location.');
      return;
    }

    setIsSearching(true);
    const details = await getPlaceDetails(prediction.placeId);
    setIsSearching(false);

    if (details) {
      setResolvedSelection(
        { lat: details.lat, lng: details.lng },
        details.meta
      );
    } else {
      setMapsError('Could not get details for this location.');
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation && !window.flutter_inappwebview) {
      return;
    }

    requestGPSLocation();

    if (window.flutter_inappwebview) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setSelectedCoords({ lat: latitude, lng: longitude });
        const resolved = await reverseGeocodeCoords(latitude, longitude);

        if (resolved) {
          setSelectedAddress(resolved.fullAddress);
          setSelectedLocationMeta({ cityName: resolved.cityName, areaName: resolved.areaName });
        }

        setStep('map');
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
      <DrawerContent className="max-h-[92vh] min-h-[60vh] flex flex-col" onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DrawerTitle className="sr-only">Location picker</DrawerTitle>
        <DrawerDescription className="sr-only">
          Search for an address, landmark, or establishment, then confirm the exact pin on the map.
        </DrawerDescription>

        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-heading font-bold text-lg text-foreground">
            {step === 'search' ? 'Select Location' : 'Confirm Location'}
          </h2>
          <div className="flex items-center gap-2">
            {step === 'map' && (
              <button
                onClick={() => setStep('search')}
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

        {step === 'search' && (
          <div className="flex-1 overflow-y-auto px-5 pb-6">
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
                <button onClick={() => { setSearch(''); setPredictions([]); searchAbortRef.current?.abort(); }}>
                  <X size={14} className="text-muted-foreground" />
                </button>
              )}
            </div>

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

            {predictions.length > 0 && (
              <div className="space-y-1">
                {predictions.map((pred) => (
                  <button
                    key={pred.id}
                    onClick={() => void handleSelectPrediction(pred)}
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

            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-secondary border border-border mb-4">
              <MapPin size={18} className="text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-heading font-medium text-[14px] text-foreground">
                  Selected Location
                </p>
                <p className="text-[12px] font-body text-muted-foreground mt-0.5 leading-relaxed">
                  {selectedAddress || 'Loading address...'}
                </p>
              </div>
            </div>

            <button
              onClick={handleConfirm}
              disabled={!selectedCoords}
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
