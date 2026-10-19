// Maps messy third-party text onto Gather's own taxonomy. Two jobs:
//   1. pick one of the canonical categories from src/data/neighborhoods.js
//   2. infer an Austin neighborhood so the event lands on the map
//
// Everything here is heuristic by design — feeds do not ship neighborhoods —
// so each function returns a confidence and callers fall back gracefully.

import {
  CATEGORIES,
  NEIGHBORHOOD_COORDS,
  NEIGHBORHOOD_NAMES,
} from '../../data/neighborhoods.js';

// Ordered: earlier entries win ties, so keep the grassroots-first categories
// near the top. Patterns are word-boundary anchored to avoid "art" matching
// "party".
const CATEGORY_RULES = [
  {
    category: 'Music/Indie',
    pattern:
      /\b(indie|live music|house show|punk|metal|dj set|dj night|vinyl|band|bands|concert|gig|singer-songwriter|synth|jazz|hip[- ]hop|open mic|record|songwriter|tour|album)\b/i,
  },
  {
    category: 'Workshops',
    pattern:
      /\b(workshop|class|classes|learn|lesson|lessons|seminar|training|skillshare|clinic|masterclass|bootcamp|tutorial|screenprinting|screen print|pottery|letterpress|bookbinding|zine making|repair cafe|teach)\b/i,
  },
  {
    category: 'Pop-ups',
    pattern:
      /\b(pop[- ]?up|popup|market|makers market|flea|swap meet|clothing swap|book sale|art sale|vendor|zine fest|sample sale|bazaar|bazaar|street fair)\b/i,
  },
  {
    category: 'Food & Drink',
    pattern:
      /\b(food|dinner|supper|brunch|tasting|chef|cuisine|brewery|beer|wine|coffee|cocktail|bakery|bbq|taco|noodle|pizza|ferment|potluck|happy hour)\b/i,
  },
  {
    category: 'Wellness',
    pattern:
      /\b(yoga|meditation|breathwork|sound bath|wellness|therapy|healing|mindfulness|pilates|fitness|run club|running club|sober|recovery|acupuncture|massage)\b/i,
  },
  {
    category: 'Outdoors',
    pattern:
      /\b(hike|hiking|trail|park cleanup|cleanup|garden|gardening|farm|bike ride|cycling|birding|outdoor|paddle|kayak|nature walk|plant swap|tree)\b/i,
  },
  {
    category: 'Art',
    pattern:
      /\b(art|arts|gallery|exhibition|exhibit|mural|painting|sculpture|photography|film screening|screening|theater|theatre|dance|poetry|performance|installation|comedy|improv|drag)\b/i,
  },
  {
    category: 'Community',
    pattern:
      /\b(community|meetup|meeting|neighborhood|block party|volunteer|mutual aid|civic|town hall|fundraiser|benefit|gathering|social|support group|book club|game night|potluck)\b/i,
  },
];

// Third-party category labels (Eventbrite, generic feed tags) mapped onto ours
// before we fall back to keyword scoring.
const EXTERNAL_CATEGORY_MAP = [
  { match: /\bmusic\b/i, category: 'Music/Indie' },
  { match: /\b(film|media|performing|visual arts|art)\b/i, category: 'Art' },
  { match: /\b(food|drink)\b/i, category: 'Food & Drink' },
  { match: /\b(health|wellness|sports|fitness)\b/i, category: 'Wellness' },
  { match: /\b(travel|outdoor|outdoors|nature)\b/i, category: 'Outdoors' },
  { match: /\b(charity|causes|volunteer|community|government|civic)\b/i, category: 'Community' },
  { match: /\b(family|education|kids|workshop|class)\b/i, category: 'Workshops' },
  { match: /\b(fashion|market|shopping|pop)\b/i, category: 'Pop-ups' },
];

export function inferCategory({ title = '', description = '', tags = [], externalCategory = '' } = {}) {
  if (externalCategory) {
    for (const rule of EXTERNAL_CATEGORY_MAP) {
      if (rule.match.test(externalCategory)) {
        return { category: rule.category, source: 'external' };
      }
    }
  }

  // Tags are hand-curated by the calendar owner, so they outrank prose.
  const tagText = (tags || []).join(' ');
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(tagText)) return { category: rule.category, source: 'tag' };
  }

  const titleText = title || '';
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(titleText)) return { category: rule.category, source: 'title' };
  }

  const bodyText = `${description}`.slice(0, 1200);
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(bodyText)) return { category: rule.category, source: 'description' };
  }

  return { category: 'Community', source: 'default' };
}

// Well-known Austin indie venues. The venue name usually appears in the
// address string, which is far more reliable than any keyword guess.
const VENUE_NEIGHBORHOODS = [
  { match: /\b(mohawk|cheer up charlies|hotel vegas|empire control room|red river|scoot inn|valhalla|beerland)\b/i, neighborhood: 'Downtown' },
  { match: /\b(far out lounge|radio coffee|sagebrush|south congress|continental club|c-boy|joann's fine foods)\b/i, neighborhood: 'South Congress' },
  { match: /\b(meanwhile brewing|govalle|the lost well|batch|cenote)\b/i, neighborhood: 'Govalle' },
  { match: /\b(whisler'?s|east austin|sahara lounge|libby's|kitchen|yellow jacket|outer heaven|kind clinic)\b/i, neighborhood: 'East Austin' },
  { match: /\b(cherrywood coffeehouse|cherrywood|the wheel|tweedy'?s)\b/i, neighborhood: 'Cherrywood' },
  { match: /\b(hyde park theatre|hyde park|quackenbush|aster'?s ethiopian)\b/i, neighborhood: 'Hyde Park' },
  { match: /\b(mueller|thinkery|camacho|mueller lake)\b/i, neighborhood: 'Mueller' },
  { match: /\b(blue genie|north loop|thunderbird|workhorse|barfly'?s)\b/i, neighborhood: 'North Loop' },
  { match: /\b(crestview|the little longhorn|gourdough'?s)\b/i, neighborhood: 'Crestview' },
  { match: /\b(zilker|barton springs|blunn creek|alamo drafthouse south)\b/i, neighborhood: 'Zilker' },
  { match: /\b(rosedale|ramsey park|seton)\b/i, neighborhood: 'Rosedale' },
  { match: /\b(west campus|ut austin|university of texas|guadalupe)\b/i, neighborhood: 'West Campus' },
  { match: /\b(clarksville|jeffrey'?s|fresh plus)\b/i, neighborhood: 'Clarksville' },
  { match: /\b(riverside|royal blue grocery|the buzz mill)\b/i, neighborhood: 'Riverside' },
  { match: /\b(travis heights|big medium|the contemporary austin)\b/i, neighborhood: 'Travis Heights' },
  { match: /\b(windsor park|windsor)\b/i, neighborhood: 'Windsor Park' },
  { match: /\b(holly|holly street|fiesta gardens)\b/i, neighborhood: 'Holly' },
  { match: /\b(barton hills|lady bird lake|barton)\b/i, neighborhood: 'Barton Hills' },
];

// Street-name heuristics for feeds that ship an address but no venue.
const STREET_NEIGHBORHOODS = [
  { match: /\b(east [0-9]{1,2}(st|th)|e\.? [0-9]{1,2}(st|th)|e 6th|east sixth)\b/i, neighborhood: 'Downtown' },
  // "Congress Ave" alone is ambiguous (it runs from downtown to South
  // Congress), so only unambiguous street names live here.
  { match: /\b(rainey|south first|s 1st|e 6th|downtown)\b/i, neighborhood: 'Downtown' },
  { match: /\b(s\.? congress|south congress)\b/i, neighborhood: 'South Congress' },
  { match: /\b(e\.? cesar chavez|cesar chavez)\b/i, neighborhood: 'East Austin' },
  { match: /\b(n\.? lamar|north lamar|lamar blvd)\b/i, neighborhood: 'Hyde Park' },
  { match: /\b(burnet)\b/i, neighborhood: 'Crestview' },
  { match: /\b(guadalupe)\b/i, neighborhood: 'West Campus' },
  { match: /\b(manor rd|manor road)\b/i, neighborhood: 'Cherrywood' },
  { match: /\b(slaughter ln|slaughter lane)\b/i, neighborhood: 'Barton Hills' },
];

function nearestNeighborhood(lat, lng) {
  let best = null;
  for (const name of NEIGHBORHOOD_NAMES) {
    const coords = NEIGHBORHOOD_COORDS[name];
    if (!coords) continue;
    const dLat = coords.lat - lat;
    const dLng = coords.lng - lng;
    const distance = dLat * dLat + dLng * dLng;
    if (!best || distance < best.distance) best = { neighborhood: name, distance };
  }
  return best;
}

export function inferNeighborhood({
  address = '',
  venue = '',
  title = '',
  description = '',
  lat = null,
  lng = null,
} = {}) {
  const venueText = `${venue} ${address}`;

  for (const rule of VENUE_NEIGHBORHOODS) {
    if (rule.match.test(venueText)) {
      return { neighborhood: rule.neighborhood, confidence: 'venue' };
    }
  }

  // An explicit neighborhood name in the address is authoritative.
  for (const name of NEIGHBORHOOD_NAMES) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(venueText)) {
      return { neighborhood: name, confidence: 'address' };
    }
  }

  for (const rule of STREET_NEIGHBORHOODS) {
    if (rule.match.test(venueText)) {
      return { neighborhood: rule.neighborhood, confidence: 'street' };
    }
  }

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const nearest = nearestNeighborhood(Number(lat), Number(lng));
    // Roughly 3km — beyond that the pin would be misleading, so fall through.
    if (nearest && nearest.distance < 0.0009) {
      return { neighborhood: nearest.neighborhood, confidence: 'coordinates' };
    }
  }

  // Last resort: the title sometimes names the neighborhood ("Holly block party").
  const titleText = `${title} ${description}`.slice(0, 400);
  for (const name of NEIGHBORHOOD_NAMES) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(titleText)) {
      return { neighborhood: name, confidence: 'title' };
    }
  }

  return { neighborhood: 'Downtown', confidence: 'default' };
}

// Grassroots tags people actually search for. Tags are deduped, lowercased,
// and capped by the normalizer.
const TAG_VOCABULARY = [
  'house show',
  'vinyl',
  'open mic',
  'comedy',
  'drag',
  'market',
  'pop-up',
  'zine',
  'poetry',
  'film',
  'screening',
  'workshop',
  'volunteer',
  'cleanup',
  'plant swap',
  'bike',
  'run club',
  'yoga',
  'garden',
  'mutual aid',
  'book club',
  'game night',
  'family friendly',
  'free',
  'all ages',
  'fundraiser',
  'dance party',
  'art walk',
  'makers',
  'food',
];

export function inferTags({ title = '', description = '', tags = [] } = {}) {
  const found = new Set(
    (tags || [])
      .map((tag) => String(tag).toLowerCase().trim())
      .filter((tag) => tag && tag.length <= 24),
  );
  const haystack = `${title} ${description}`.toLowerCase();
  for (const term of TAG_VOCABULARY) {
    if (found.size >= 6) break;
    if (haystack.includes(term)) found.add(term);
  }
  return [...found].slice(0, 6);
}

export function isKnownCategory(value) {
  return CATEGORIES.includes(value);
}
