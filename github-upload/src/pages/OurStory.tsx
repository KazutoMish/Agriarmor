import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Sprout } from 'lucide-react';

export default function OurStory() {
  return <div className="info-page">
    <div className="page-wrap info-page-heading">
      <div className="page-title left">
        <p className="eyebrow">ROOTED IN NATURE. READY FOR RUST.</p>
        <h1>Our <em>story.</em></h1>
        <p>Grown from a good idea. Proudly made in the Philippines.</p>
      </div>
    </div>
    <section className="story-section" id="story">
      <div className="story-art">
        <span className="eyebrow">NOT ALL SECOND CHANCES LOOK THE SAME.</span>
        <div className="story-orbit" />
        <img src="/assets/tomato.png" alt="Tomato slice, one of the ingredients behind RedRevive" width="330" height="330" loading="lazy" />
        <span className="story-art-type">good things<br />can grow<br /><em>from surplus.</em></span>
        <span className="story-art-foot">FROM OUR SOIL. FOR YOUR STEEL. <Sprout size={19} /></span>
      </div>
      <div className="story-copy">
        <p className="eyebrow">THE STORY BEHIND THE RED</p>
        <h2>Saving crops.<br /><em>Shielding steels.</em></h2>
        <p>We saw possibility where others saw surplus. AgriArmor connects the agricultural harvest with a simple, everyday need: giving rusty metal a fresh start.</p>
        <p>Made with surplus tomatoes and kamias, RedRevive brings agricultural ingredients into a practical, surface-clinging gel. A small step toward a more circular future, rooted right here in the Philippines.</p>
        <div className="story-points">
          <span><Check size={16} /> Agricultural surplus, given a purpose</span>
          <span><Check size={16} /> A gel designed to cling to metal</span>
          <span><Check size={16} /> Created in San Jose del Monte, Bulacan</span>
        </div>
        <Link to="/products" className="text-link">Get to know RedRevive <ArrowUpRight size={17} /></Link>
      </div>
    </section>
    <section className="closing-section">
      <span className="closing-flower">✳</span>
      <div>
        <p className="eyebrow">LESS FUSS. MORE FRESH STARTS.</p>
        <h2>A little gel. <em>A simple routine.</em></h2>
      </div>
      <Link className="button" to="/how-it-works">See how it works <ArrowRight size={17} /></Link>
    </section>
  </div>;
}
