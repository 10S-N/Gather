import { useParams, Link } from 'react-router-dom';
import { mockEvents } from '../data/testevents';

function EventDetailPage() {
  const { id } = useParams();
  
  // Find the matching event based on the card clicked
  const event = mockEvents.find(e => e.id === id);

  if (!event) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <h2>Event Not Found</h2>
        <Link to="/" style={{ color: 'var(--navy)' }}>Return to Events Board</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem' }}>
      {/* Back navigation element */}
      <Link to="/" style={{ textDecoration: 'none', color: 'var(--rust)', fontWeight: 'bold', display: 'inline-block', marginBottom: '1.5rem' }}>
        ← BACK TO ALL EVENTS
      </Link>

      {/* Visual Header Grid Area */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gap: '30px',
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '16px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
        border: '1px solid var(--border)'
      }}>
        
        {/* Banner Column */}
        <div style={{
          height: '300px',
          borderRadius: '12px',
          backgroundImage: `url(${event.image})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundColor: 'var(--rust)'
        }} />

        {/* Informational Column */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <span style={{
              backgroundColor: 'var(--sand)',
              color: 'var(--navy)',
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '13px',
              fontWeight: 'bold'
            }}>{event.category}</span>
            
            <h1 style={{ margin: '10px 0 5px 0', fontSize: '32px' }}>{event.title}</h1>
            <p style={{ color: 'var(--earth)', fontSize: '16px', margin: '5px 0' }}>🗓️ {event.date}</p>
            <p style={{ color: 'var(--earth)', fontSize: '16px', margin: '5px 0' }}>📍 {event.location}</p>
          </div>

          {/* Dynamic Registration/Payment Section */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span style={{ fontSize: '16px', color: 'var(--earth)' }}>Admission Cost:</span>
              <span style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--navy)' }}>{event.price}</span>
            </div>

            <button 
              onClick={() => alert(`🎉 Registration successful for ${event.title}! Processing payment value: ${event.price}`)}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--navy)',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '16px',
                cursor: 'pointer',
                boxShadow: '0 4px 6px rgba(40,56,89,0.2)'
              }}
            >
              {event.price === 'Free' ? 'RSVP / Register Free' : 'Secure Admission Pass'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

export default EventDetailPage;