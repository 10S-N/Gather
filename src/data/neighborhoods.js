// Canonical taxonomy for Gather. Everything that filters, posts, or maps an
// event reads from here so the dropdowns, chips, and map pins never drift.
//
// Coordinates are approximate neighborhood centroids, not exact addresses.
// They exist so the map view can place a pin per neighborhood without asking
// the host to drop a marker (or paying for a geocoding API).

export const CATEGORIES = [
  'Art',
  'Community',
  'Pop-ups',
  'Music/Indie',
  'Workshops',
  'Food & Drink',
  'Wellness',
  'Outdoors',
];

export const NEIGHBORHOODS = [
  { name: 'Downtown', lat: 30.2672, lng: -97.7431 },
  { name: 'East Austin', lat: 30.2627, lng: -97.7195 },
  { name: 'South Congress', lat: 30.2466, lng: -97.7498 },
  { name: 'Travis Heights', lat: 30.249, lng: -97.744 },
  { name: 'Holly', lat: 30.254, lng: -97.724 },
  { name: 'Govalle', lat: 30.265, lng: -97.696 },
  { name: 'Cherrywood', lat: 30.288, lng: -97.705 },
  { name: 'Windsor Park', lat: 30.309, lng: -97.688 },
  { name: 'Mueller', lat: 30.2985, lng: -97.704 },
  { name: 'Hyde Park', lat: 30.306, lng: -97.731 },
  { name: 'North Loop', lat: 30.3195, lng: -97.7215 },
  { name: 'Crestview', lat: 30.335, lng: -97.723 },
  { name: 'Rosedale', lat: 30.312, lng: -97.739 },
  { name: 'West Campus', lat: 30.2865, lng: -97.7435 },
  { name: 'Clarksville', lat: 30.279, lng: -97.753 },
  { name: 'Zilker', lat: 30.266, lng: -97.77 },
  { name: 'Barton Hills', lat: 30.257, lng: -97.787 },
  { name: 'Riverside', lat: 30.24, lng: -97.72 },
];

export const NEIGHBORHOOD_NAMES = NEIGHBORHOODS.map((n) => n.name);

export const NEIGHBORHOOD_COORDS = NEIGHBORHOODS.reduce((acc, n) => {
  acc[n.name] = { lat: n.lat, lng: n.lng };
  return acc;
}, {});

// Optional emoji used on category chips. Kept separate so the category strings
// stored in Firestore stay plain text.
export const CATEGORY_EMOJI = {
  Art: '🎨',
  Community: '🤝',
  'Pop-ups': '✨',
  'Music/Indie': '🎸',
  Workshops: '🛠️',
  'Food & Drink': '🍜',
  Wellness: '🌿',
  Outdoors: '🌳',
};
