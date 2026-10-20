// Convenience entry point for the Eventbrite adapter.
//
// The implementation lives with the other ingestion adapters in
// ../ingestion/sources/eventbrite.js (that is what the source registry and the
// tests import). This module re-exports it so a caller can also import the
// adapter from src/services/adapters/eventbrite.js without duplicating code.

export { eventbriteSource, mapEventbriteEvent } from '../ingestion/sources/eventbrite.js';
