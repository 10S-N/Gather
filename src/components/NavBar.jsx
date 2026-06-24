import { Link } from 'react-router-dom';

function NavBar() {
  return (
    <nav style={{ 
      display: 'flex', 
      justifyContent: 'space-between', 
      padding: '1rem 2rem', 
      background: '#283859', // Using your beautiful navy brand color!
      color: 'white' 
    }}>
      <h2>GATHER</h2>
      <div style={{ display: 'flex', gap: '20px' }}>
        <Link to="/" style={{ color: 'white', textDecoration: 'none' }}>Events</Link>
        <Link to="/post-event" style={{ color: 'white', textDecoration: 'none' }}>Post Event</Link>
        <Link to="/profile" style={{ color: 'white', textDecoration: 'none' }}>Profile</Link>
      </div>
    </nav>
  );
}

export default NavBar;