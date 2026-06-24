import { useState } from 'react';
import { Link } from 'react-router-dom';
import { mockEvents } from '../data/testevents';

function HomePage() {
  // State variables to track selected filter options
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedPrice, setSelectedPrice] = useState('All');

  // Filter logic processing the dataset
  const filteredEvents = mockEvents.filter(event => {
    const matchesCategory = selectedCategory === 'All' || event.category === selectedCategory;
    const matchesPrice = selectedPrice === 'All' || 
      (selectedPrice === 'Free' && event.price === 'Free') ||
      (selectedPrice === 'Paid' && event.price !== 'Free');
    return matchesCategory && matchesPrice;
  });

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      
      {/* LEFT SIDEBAR: FILTERS */}
      {/* 3. FIXED: Decreased width from 280px to 220px */}
      <aside style={{
        width: '220px',
        backgroundColor: 'var(--sand)', 
        padding: '1.5rem',
        borderRight: '1px solid var(--border)'
      }}>
        <h2 style={{ color: 'var(--earth)', fontSize: '20px', marginBottom: '1.5rem' }}>FILTERS</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* 2. FIXED: Filter Select Dropdowns */}
          <div>
            <label style={labelStyle}>Category</label>
            <select 
              value={selectedCategory} 
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={selectStyle}
            >
              <option value="All">All Categories</option>
              <option value="Academic">Academic</option>
              <option value="Community">Community</option>
              <option value="Entertainment">Entertainment</option>
              <option value="Social">Social</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Price Option</label>
            <select 
              value={selectedPrice} 
              onChange={(e) => setSelectedPrice(e.target.value)}
              style={selectStyle}
            >
              <option value="All">All Prices</option>
              <option value="Free">Free Events</option>
              <option value="Paid">Paid Events</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Location Area</label>
            <select style={selectStyle} disabled>
              <option>All Austin Areas</option>
            </select>
          </div>
        </div>
      </aside>

      {/* RIGHT CONTENT AREA: HERO, SEARCH, & EVENT GRID */}
      <main style={{ flex: 1, padding: '2rem' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1>FIND EVENTS NEAR YOU</h1>
          <p>Discover what's happening in your community.</p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
          <input 
            type="text" 
            placeholder="Search events, locations, or keywords..." 
            style={{
              width: '100%',
              maxWidth: '600px',
              padding: '12px 20px',
              borderRadius: '25px',
              border: '1px solid var(--border)',
              fontSize: '16px'
            }}
          />
        </div>

        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          borderBottom: '2px solid var(--rust)', 
          paddingBottom: '10px',
          marginBottom: '2rem'
        }}>
          <span style={{ fontWeight: 'bold', color: 'var(--rust)' }}>
            {filteredEvents.length} EVENTS FOUND
          </span>
          <span style={{ color: 'var(--earth)' }}>SORT: DATE (SOONEST)</span>
        </div>

        {/* RESPONSIVE EVENT CARDS GRID */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '20px'
        }}>
          {filteredEvents.map((event) => (
            /* 1. FIXED: Wrapped in a Link tag to route to individual detail pages */
            <Link 
              to={`/event/${event.id}`} 
              key={event.id} 
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{
                borderRadius: '12px',
                overflow: 'hidden',
                backgroundColor: 'white',
                boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
                border: '1px solid var(--border)',
                transition: 'transform 0.2s',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
              >
                <div style={{ 
                  height: '160px', 
                  backgroundColor: 'var(--rust)', 
                  backgroundImage: `url(${event.image})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }} />

                <div style={{ padding: '15px' }}>
                  <h3 style={{ fontSize: '18px', margin: '0 0 5px 0', color: 'var(--navy)' }}>
                    {event.title}
                  </h3>
                  <p style={{ fontSize: '14px', margin: '0 0 10px 0', color: 'var(--earth)' }}>
                    {event.date} • {event.location}
                  </p>
                  <span style={{
                    backgroundColor: event.price === 'Free' ? 'var(--sage)' : 'var(--sand)',
                    color: 'var(--navy)',
                    padding: '4px 10px',
                    borderRadius: '15px',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}>
                    {event.price}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}

// Inline styles for cleaner selector dropdown elements
const labelStyle = {
  display: 'block',
  fontSize: '14px',
  fontWeight: '600',
  color: 'var(--earth)',
  marginBottom: '5px'
};

const selectStyle = {
  width: '100%',
  padding: '10px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  backgroundColor: '#fcfbfa',
  color: 'var(--earth)',
  fontSize: '14px',
  cursor: 'pointer'
};

export default HomePage;