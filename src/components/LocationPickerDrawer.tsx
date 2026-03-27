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
  source: 'google' | 'osm';
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

const parseAddressFromText = (address: string): Pick<LocationMeta, 'cityName' | 'areaName'> => {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 4) {
    return {
      areaName: parts[parts.length - 4],
      cityName: parts[parts.length - 3] || parts[0] || 'Unknown',
    };
  }

  if (parts.length === 3) {
    return {
      areaName: parts[0],
      cityName: parts[1] || 'Unknown',
    };
  }

  return {
    cityName: parts[0] || 'Unknown',
  };
};

const parseGoogleAddressMeta = (
  components?: google.maps.GeocoderAddressComponent[]
): Pick<LocationMeta, 'cityName' | 'areaName'> => {
  const findByType = (...types: string[]) =>
    components?.find((component) => types.every((type) => component.types.includes(type)))?.long_name;

  return {
    cityName:
      findByType('locality') ||
      findByType('administrative_area_level_2') ||
      findByType('administrative_area_level_1') ||
      'Unknown',
    areaName:
      findByType('sublocality_level_1') ||
      findByType('sublocality') ||
      findByType('neighborhood') ||
      findByType('route') ||
      undefined,
  };
};

const parseOsmAddressMeta = (address: Record<string, string | undefined> = {}): Pick<LocationMeta, 'cityName' | 'areaName'> => ({
  cityName:
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.state_district ||
    address.state ||
    'Unknown',
  areaName:
    address.suburb ||
    address.neighbourhood ||
    address.city_district ||
    address.county ||
    undefined,
});

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

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerInstance = useRef<google.maps.Marker | null>(null);
  const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesService = useRef<google.maps.places.PlacesService | null>(null);
  const geocoder = useRef<google.maps.Geocoder | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const searchAbortRef = useRef<AbortController | null>(null);

  const setResolvedSelection = useCallback((coords: { lat: number; lng: number }, meta: LocationMeta) => {
    setSelectedCoords(coords);
    setSelectedAddress(meta.fullAddress);
    setSelectedLocationMeta({ cityName: meta.cityName, areaName: meta.areaName });
    setStep('map');
  }, []);

  const reverseGeocodeWithOsm = useCallback(async (lat: number, lng: number): Promise<LocationMeta> => {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );

    const data = await response.json();
    const meta = parseOsmAddressMeta(data.address || {});

    return {
      ...meta,
      fullAddress: data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    };
  }, []);

  const reverseGeocodeCoords = useCallback(async (lat: number, lng: number) => {
    try {
      if ((window as Window & typeof globalThis & { google?: typeof google }).google?.maps) {
        if (!geocoder.current) {
          geocoder.current = new google.maps.Geocoder();
        }

        const googleResult = await new Promise<LocationMeta | null>((resolve) => {
          geocoder.current?.geocode({ location: { lat, lng } }, (results, status) => {
            if (status === 'OK' && results && results.length > 0) {
              const preferred =
                results.find((result) =>
                  result.types.includes('street_address') ||
                  result.types.includes('premise') ||
                  result.types.includes('subpremise') ||
                  result.types.includes('point_of_interest')
                ) || results[0];

              resolve({
                ...parseGoogleAddressMeta(preferred.address_components),
                fullAddress: preferred.formatted_address,
              });
              return;
            }

            resolve(null);
          });
        });

        if (googleResult) {
          setSelectedAddress(googleResult.fullAddress);
          setSelectedLocationMeta({ cityName: googleResult.cityName, areaName: googleResult.areaName });
          return googleResult;
        }
      }
    } catch {
      setMapsError('Google location lookup is unavailable right now, so backup address lookup is being used.');
    }

    const fallbackResult = await reverseGeocodeWithOsm(lat, lng);
    setSelectedAddress(fallbackResult.fullAddress);
    setSelectedLocationMeta({ cityName: fallbackResult.cityName, areaName: fallbackResult.areaName });
    return fallbackResult;
  }, [reverseGeocodeWithOsm]);

  const searchWithOsm = useCallback(async (query: string) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&q=${encodeURIComponent(query)}`,
        {
          headers: { 'Accept-Language': 'en' },
          signal: controller.signal,
        }
      );

      const data = await response.json();
      const fallbackPredictions: SearchPrediction[] = Array.isArray(data)
        ? data.map((item: any) => {
            const meta = parseOsmAddressMeta(item.address || {});
            const title = item.name || meta.areaName || meta.cityName || item.display_name;
            const descriptionParts = item.display_name
              ?.split(',')
              .map((part: string) => part.trim())
              .filter(Boolean) || [];

            return {
              id: `${item.place_id}`,
              title,
              subtitle: descriptionParts.slice(1).join(', '),
              description: item.display_name,
              source: 'osm',
              lat: Number(item.lat),
              lng: Number(item.lon),
              cityName: meta.cityName,
              areaName: meta.areaName,
            };
          })
        : [];

      setPredictions(fallbackPredictions);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPredictions([]);
      }
    }
  }, []);

  const resolveSearchFallback = useCallback(async (query: string) => {
    await searchWithOsm(query);
  }, [searchWithOsm]);

  // Load Google Maps on open
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
      searchAbortRef.current?.abort();
    }
  }, [open]);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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
      zoom: 16,
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

    geocoder.current = new google.maps.Geocoder();

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

  // Init autocomplete service
  useEffect(() => {
    if (!mapsLoaded) return;
    autocompleteService.current = new google.maps.places.AutocompleteService();
    const div = document.createElement('div');
    placesService.current = new google.maps.places.PlacesService(div);
  }, [mapsLoaded]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      searchAbortRef.current?.abort();
      setPredictions([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      if (!autocompleteService.current) {
        void resolveSearchFallback(value);
        return;
      }

      autocompleteService.current.getPlacePredictions(
        {
          input: value,
          componentRestrictions: { country: 'in' },
        },
        (preds, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && preds?.length) {
            setPredictions(
              preds.map((pred) => ({
                id: pred.place_id,
                title: pred.structured_formatting.main_text,
                subtitle: pred.structured_formatting.secondary_text,
                description: pred.description,
                source: 'google',
                placeId: pred.place_id,
              }))
            );
            return;
          }

          if (status === google.maps.places.PlacesServiceStatus.REQUEST_DENIED) {
            setMapsError('Google Places search is blocked for this API key/project right now. Enable billing in Google Cloud, or the app will use backup address search.');
          }

          void resolveSearchFallback(value);
        }
      );
    }, 300);
  };

  const handleSelectPrediction = async (prediction: SearchPrediction) => {
    if (prediction.source === 'osm' && prediction.lat != null && prediction.lng != null) {
      setResolvedSelection(
        { lat: prediction.lat, lng: prediction.lng },
        {
          cityName: prediction.cityName || parseAddressFromText(prediction.description).cityName,
          areaName: prediction.areaName || parseAddressFromText(prediction.description).areaName,
          fullAddress: prediction.description,
        }
      );
      return;
    }

    if (!placesService.current || !prediction.placeId) {
      const fallbackResults = await searchWithOsm(prediction.description);
      return fallbackResults;
    }

    placesService.current.getDetails(
      { placeId: prediction.placeId, fields: ['geometry', 'formatted_address', 'address_components'] },
      async (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const metaFromComponents = parseGoogleAddressMeta(place.address_components);
          const meta = {
            cityName: metaFromComponents.cityName !== 'Unknown' ? metaFromComponents.cityName : parseAddressFromText(place.formatted_address || prediction.description).cityName,
            areaName: metaFromComponents.areaName || parseAddressFromText(place.formatted_address || prediction.description).areaName,
            fullAddress: place.formatted_address || prediction.description,
          };
          setResolvedSelection({ lat, lng }, meta);
          return;
        }

        setMapsError('Google place details failed, so backup address search is being used.');
        await searchWithOsm(prediction.description);
      }
    );
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation && !window.flutter_inappwebview) {
      return;
    }

    requestGPSLocation();

    if (window.flutter_inappwebview) {
      return;
    }

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

    const fallbackMeta = parseAddressFromText(selectedAddress);

    setLocation({
      cityName: selectedLocationMeta?.cityName || fallbackMeta.cityName,
      areaName: selectedLocationMeta?.areaName || fallbackMeta.areaName,
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
              {search && (
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

            {search && predictions.length === 0 && (
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
