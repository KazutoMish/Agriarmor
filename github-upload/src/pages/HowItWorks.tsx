import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight, Droplets, Recycle, ShieldCheck } from 'lucide-react';

const steps = [
  {
    n: '01',
    title: 'Prep & apply',
    text: 'Clean away grease, dirt, and loose rust. Apply the gel directly to the affected area.',
    icon: <Droplets />,
  },
  {
    n: '02',
    title: 'Let it get to work',
    text: 'Leave for 15–30 minutes for light rust, or 1–3 hours for heavier oxidation.',
    icon: <ArrowDown />,
  },
  {
    n: '03',
    title: 'Scrub & rinse',
    text: 'Use a nylon or brass brush to loosen rust. Rinse with water or wipe with a wet cloth.',
    icon: <Recycle />,
  },
  {
    n: '04',
    title: 'Dry & protect',
    text: 'Dry immediately and finish with oil, wax, or paint to help protect against flash rust.',
    icon: <ShieldCheck />,
  },
];

export default function HowItWorks() {
  return <div className="info-page">
    <div className="page-wrap info-page-heading">
      <div className="page-title left">
        <p className="eyebrow">GIVE YOUR METAL A FRESH START</p>
        <h1>How it works</h1>
        <p>Give your tools a little care. They’ve still got work to do.</p>
      </div>
    </div>
    <section className="section how-section" id="how-it-works">
      <div className="section-heading">
        <div>
          <p className="eyebrow">LESS FUSS. MORE FRESH STARTS.</p>
          <h2>A little gel. <em>A simple routine.</em></h2>
        </div>
        <p>Give your tools a little care.<br />They’ve still got work to do.</p>
      </div>
      <div className="how-guide-layout">
        <a className="how-process-image" href="/assets/redrevive-process.png" target="_blank" rel="noreferrer" aria-label="View the AgriArmor manufacturing process diagram at full size">
          <img src="/assets/redrevive-process.png" alt="AgriArmor manufacturing process: extraction, acid stabilization, gel blending and preservation, quality control, and bottling and labelling." width="2000" height="2000" loading="lazy" />
        </a>
        <div className="how-instructions">
          <div className="steps-grid">
            {steps.map(step => <article key={step.n}>
              <div className="step-top"><span>{step.n}</span>{step.icon}</div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>)}
          </div>
          <p className="handling-note"><ShieldCheck size={15} /> A little care goes a long way: wear gloves and eye protection, follow the label, and test a small hidden area first.</p>
        </div>
      </div>
    </section>
    <section className="closing-section">
      <span className="closing-flower">✳</span>
      <div>
        <p className="eyebrow">YOUR METAL’S NEXT CHAPTER STARTS HERE.</p>
        <h2>A little red. <em>A fresh start.</em></h2>
      </div>
      <Link className="button" to="/products">Find your RedRevive <ArrowUpRight size={17} /></Link>
    </section>
  </div>;
}
