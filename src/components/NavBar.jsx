import { Link } from 'react-router-dom';

function NavBar() {
  return (
    <nav style={{ 
      display: 'grid',
      gridTemplateColumns: '220px 1fr 220px', /* Matches your 220px filter sidebar width perfectly! */
      alignItems: 'center',
      padding: '0.75rem 2rem', 
      background: 'var(--navy)', 
      color: 'white',
      height: '60px',
      boxSizing: 'border-box'
    }}>
      {/* LEFT: Logo Branding - now locked exactly to the left side edge */}
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <Link to="/" style={{ color: 'white', textDecoration: 'none' }}>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold', letterSpacing: '1.5px', color: 'white' }}>
            GATHER
          </h2>
        </Link>
      </div>
      
      {/* MIDDLE: Centered main navigation links */}
      <div style={{ display: 'flex', gap: '40px', justifyContent: 'center' }}>
        <Link to="/" style={navLinkStyle}>EVENTS</Link>
        <Link to="/messages" style={navLinkStyle}>MESSAGES</Link>
        <Link to="/profile" style={navLinkStyle}>PROFILE</Link>
      </div>

      {/* RIGHT: User Authentication Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <button style={{
          background: 'none',
          border: '1px solid #ffffffa0',
          color: 'white',
          padding: '6px 16px',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: '500'
        }}>Log in</button>
        
        <button style={{
          background: 'var(--rust)', 
          border: 'none',
          color: 'white',
          padding: '6px 16px',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: '500'
        }}>Sign up</button>
      </div>
    </nav>
  );
}

const navLinkStyle = {
  color: '#ffffffb0',
  textDecoration: 'none',
  fontWeight: '600',
  fontSize: '14px',
  letterSpacing: '0.5px'
};

export default NavBar;