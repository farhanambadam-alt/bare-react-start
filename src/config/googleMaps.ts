/**
 * Google Maps configuration.
 * Replace the placeholder with your actual API key.
 * The key must have Maps JavaScript API and Places API enabled.
 */
export const GOOGLE_MAPS_API_KEY = 'AIzaSyC-_HwDKeXM8RK2LeEY06IcF0TiyjnVcyw';

let loadPromise: Promise<void> | null = null;

export function loadGoogleMapsScript(): Promise<void> {
  if ((window as any).google?.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });

  return loadPromise;
}
