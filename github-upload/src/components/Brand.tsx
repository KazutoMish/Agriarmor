import { Link } from 'react-router-dom';

const logo = '/assets/agriarmor-logo.png?v=2';

export default function Brand({ light = false }: { light?: boolean }) {
  return <Link to="/" className={`brand business-brand${light ? ' brand-light' : ''}`} aria-label="AgriArmor home">
    <img className="business-logo" src={logo} alt="AgriArmor — Saving Crops, Shielding Steels." width="500" height="500" />
  </Link>;
}
