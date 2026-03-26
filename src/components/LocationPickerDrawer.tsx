import { MapPin, Search, Loader2, Navigation, X, Check } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { useLocation_ } from '@/contexts/LocationContext';
import { loadGoogleMapsScript } from '@/config/googleMaps';

interface LocationPickerDrawerProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'search' | 'map';

const LocationPickerDrawer = ({ open, onClose }: LocationPickerDrawerProps) => {
  const { setLocation, requestGPSLocation, isLocating, locationError } = useLocation_();

  const [step, setStep] = useState<Step>('search');
  const [search, setSearch] = useState('');
  const [predictions, setPredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerInstance = useRef<google.maps.Marker | null>(null);
  const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesService = useRef<google.maps.places.PlacesService | null>(null);
  const geocoder = useRef<google.maps.Geocoder | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
    }
  }, [open]);

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
      reverseGeocodeCoords(lat, lng);
    });

    // Also allow clicking on map to move marker
    mapInstance.current.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      markerInstance.current?.setPosition(e.latLng);
      setSelectedCoords({ lat, lng });
      reverseGeocodeCoords(lat, lng);
    });
  }, [step, mapsLoaded, selectedCoords?.lat, selectedCoords?.lng]);

  // Init autocomplete service
  useEffect(() => {
    if (!mapsLoaded) return;
    autocompleteService.current = new google.maps.places.AutocompleteService();
    // Create a dummy div for PlacesService
    const div = document.createElement('div');
    placesService.current = new google.maps.places.PlacesService(div);
  }, [mapsLoaded]);

  const reverseGeocodeCoords = useCallback((lat: number, lng: number) => {
    if (!geocoder.current) {
      geocoder.current = new google.maps.Geocoder();
    }
    geocoder.current.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === 'OK' && results?.[0]) {
        setSelectedAddress(results[0].formatted_address);
      }
    });
  }, []);

  // Search handler with debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim() || !autocompleteService.current) {
      setPredictions([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      autocompleteService.current!.getPlacePredictions(
        {
          input: value,
          componentRestrictions: { country: 'in' },
        },
        (preds, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && preds) {
            setPredictions(preds);
          } else {
            setPredictions([]);
          }
        }
      );
    }, 300);
  };

  const handleSelectPrediction = (prediction: google.maps.places.AutocompletePrediction) => {
    if (!placesService.current) return;

    placesService.current.getDetails(
      { placeId: prediction.place_id, fields: ['geometry', 'formatted_address', 'address_components'] },
      (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          setSelectedCoords({ lat, lng });
          setSelectedAddress(place.formatted_address || prediction.description);
          setStep('map');
        }
      }
    );
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      return;
    }

    requestGPSLocation();

    // Also get coords for the map
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setSelectedCoords({ lat: latitude, lng: longitude });

        if (mapsLoaded) {
          const gc = new google.maps.Geocoder();
          gc.geocode({ location: { lat: latitude, lng: longitude } }, (results, status) => {
            if (status === 'OK' && results?.[0]) {
              setSelectedAddress(results[0].formatted_address);
            } else {
              setSelectedAddress(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
            }
            setStep('map');
          });
        } else {
          setSelectedAddress(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
          setStep('map');
        }
      },
      () => { /* error handled by context */ },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleConfirm = () => {
    if (!selectedCoords) return;

    // Extract city/area from address
    const parts = selectedAddress.split(',').map((p) => p.trim());
    const cityName = parts.length >= 3 ? parts[parts.length - 3] : parts[0] || 'Unknown';
    const areaName = parts.length >= 4 ? parts[parts.length - 4] : parts[0] || undefined;

    setLocation({
      cityName,
      areaName,
      lat: selectedCoords.lat,
      lng: selectedCoords.lng,
      source: 'manual',
      fullAddress: selectedAddress,
    });
    onClose();
  };

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[92vh] min-h-[60vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-heading font-bold text-lg text-foreground">
            {step === 'search' ? 'Select Location' : 'Confirm Location'}
          </h2>
          <button
            onClick={step === 'map' ? () => setStep('search') : onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-secondary active:scale-95 transition-transform"
            aria-label={step === 'map' ? 'Back to search' : 'Close'}
          >
            <X size={18} className="text-muted-foreground" />
          </button>
        </div>

        {mapsError && (
          <div className="mx-5 mb-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
            <p className="text-[13px] font-body text-destructive">{mapsError}</p>
          </div>
        )}

        {step === 'search' && (
          <div className="flex-1 overflow-y-auto px-5 pb-6">
            {/* Search bar */}
            <div className="flex items-center gap-2.5 bg-secondary border border-border rounded-2xl px-4 py-3 mb-4">
              <Search size={16} className="text-muted-foreground flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search for area, street name..."
                className="flex-1 bg-transparent text-[14px] font-body text-foreground placeholder:text-muted-foreground outline-none"
                autoFocus
              />
              {search && (
                <button onClick={() => { setSearch(''); setPredictions([]); }}>
                  <X size={14} className="text-muted-foreground" />
                </button>
              )}
            </div>

            {/* Use current location */}
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

            {/* Predictions */}
            {predictions.length > 0 && (
              <div className="space-y-1">
                {predictions.map((pred) => (
                  <button
                    key={pred.place_id}
                    onClick={() => handleSelectPrediction(pred)}
                    className="w-full flex items-start gap-3 p-3.5 rounded-2xl bg-card border border-border active:scale-[0.98] transition-transform text-left"
                  >
                    <MapPin size={16} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-medium text-[14px] text-foreground truncate">
                        {pred.structured_formatting.main_text}
                      </p>
                      <p className="text-[11px] font-body text-muted-foreground mt-0.5 truncate">
                        {pred.structured_formatting.secondary_text}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Empty state */}
            {search && predictions.length === 0 && mapsLoaded && (
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
            {/* Map container */}
            <div className="relative flex-1 min-h-[280px] rounded-2xl overflow-hidden border border-border mb-4">
              <div ref={mapRef} className="w-full h-full min-h-[280px]" />
              {/* Center crosshair hint */}
              <div className="absolute top-3 left-3 right-3">
                <div className="bg-background/90 backdrop-blur-sm rounded-xl px-3 py-2 border border-border shadow-sm">
                  <p className="text-[11px] font-body text-muted-foreground text-center">
                    Drag the pin or tap to adjust location
                  </p>
                </div>
              </div>
            </div>

            {/* Selected address */}
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

            {/* Confirm button */}
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
