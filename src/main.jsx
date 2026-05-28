import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  Boxes,
  Code2,
  Download,
  LogIn,
  Mail,
  Moon,
  PackagePlus,
  Shield,
  ShoppingCart,
  Send,
  ShoppingBag,
  Sparkles,
  Sun,
  Trash2,
  UserPlus,
  Wand2,
} from 'lucide-react';
import { siteContent } from './content';
import './styles.css';

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('shanex-theme') || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('shanex-theme', theme);
  }, [theme]);

  return [theme, setTheme];
}

function useScrollScenes() {
  useEffect(() => {
    const scenes = Array.from(document.querySelectorAll('[data-scroll-scene]'));
    let frame = 0;

    const update = () => {
      frame = 0;
      const viewportHeight = window.innerHeight || 1;

      scenes.forEach((scene) => {
        const rect = scene.getBoundingClientRect();
        const progress = (viewportHeight - rect.top) / (rect.height + viewportHeight);
        const clamped = Math.min(1, Math.max(0, progress));
        scene.style.setProperty('--scene-progress', clamped.toFixed(4));
      });
    };

    const requestUpdate = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);

    return () => {
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
}

function useRoute() {
  const getRoute = () => {
    const hash = window.location.hash || '#/';
    if (hash.startsWith('#/#')) return '/';
    if (!hash.startsWith('#/')) return '/';
    return hash.slice(1) || '/';
  };

  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const update = () => setRoute(getRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    const hash = window.location.hash || '';
    const section = hash.startsWith('#/#') ? hash.replace('#/#', '') : '';

    window.setTimeout(() => {
      if (section) {
        document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' });
        return;
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 0);
  }, [route]);

  return route;
}

function LogoMark() {
  return (
    <div className="logo" aria-label={siteContent.brand.name}>
      <span className="logo-x">X</span>
      <span>
        <strong>{siteContent.brand.name}</strong>
        <small>{siteContent.brand.tagline}</small>
      </span>
    </div>
  );
}

function AmbientGrid() {
  const dots = useMemo(() => Array.from({ length: 80 }, (_, i) => i), []);
  return (
    <div className="ambient" aria-hidden="true">
      <div className="wave wave-a" />
      <div className="wave wave-b" />
      <div className="orb-line" />
      <div className="dot-grid">
        {dots.map((dot) => (
          <i key={dot} />
        ))}
      </div>
    </div>
  );
}

function ThemeToggle({ theme, setTheme }) {
  const isDark = theme === 'dark';
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
      <span>{isDark ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function HeroCard() {
  return (
    <div className="hero-board print-board" aria-label="SHANEX print head reveal animation">
      <PrintHeadReveal mode="auto" />
    </div>
  );
}

function PrintHeadReveal({ mode = 'auto' }) {
  return (
    <div className={`print-scene ${mode}`} aria-hidden="true">
      <div className="print-arc" />
      <div className="print-paper">
        <div className="print-paper-grid" />
        <div className="paper-strip">
          <div className="print-row word-develop">DEVELOP</div>
          <div className="print-row word-design">DESIGN</div>
          <div className="print-row word-print">PRINT</div>
          <div className="print-row word-final">ALL IN ONE PLACE</div>
        </div>
        <div className="ink-lines">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="print-rail" />
      <div className="print-head">
        <span />
        <i />
      </div>
    </div>
  );
}

function ServiceCard({ service, index }) {
  const Icon = service.icon;
  return (
    <article className={`service-card ${service.gradient}`} style={{ '--delay': `${index * 120}ms` }}>
      <div className="service-icon">
        <Icon size={26} />
      </div>
      <p className="kicker">{service.kicker}</p>
      <h3>{service.title}</h3>
      <p>{service.text}</p>
      <div className="tag-row">
        {service.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </article>
  );
}

function ScrollStory() {
  return (
    <section id="motion" className="scroll-story" data-scroll-scene>
      <div className="story-sticky">
        <div className="story-copy">
          <div className="eyebrow">
            <Sparkles size={16} />
            {siteContent.scrollStory.eyebrow}
          </div>
          <span className="number">{siteContent.scrollStory.number}</span>
          <h2>{siteContent.scrollStory.title}</h2>
          <p>{siteContent.scrollStory.description}</p>
          <div className="story-steps">
            {siteContent.scrollStory.steps.map(([title, text], index) => (
              <article key={title} style={{ '--step': index }}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="story-visual" aria-label="Scroll animated SHANEX workflow">
          <PrintHeadReveal mode="scroll" />
          <div className="story-progress">
            <span />
          </div>
        </div>
      </div>
    </section>
  );
}

function ReleaseCard({ release }) {
  const Icon = release.icon;
  return (
    <article className="release-card">
      <div className="release-copy">
        <div className="release-meta">
          <span className="release-icon"><Icon size={24} /></span>
          <span>{release.version}</span>
          <span>{release.status}</span>
        </div>
        <h3>{release.name}</h3>
        <p>{release.summary}</p>
        <div className="release-highlights">
          {release.highlights.map(([label, HighlightIcon]) => (
            <div key={label}>
              <HighlightIcon size={18} />
              <span>{label}</span>
            </div>
          ))}
        </div>
        <a className="secondary-action release-action" href="#contact">
          {release.action} <ArrowUpRight size={18} />
        </a>
      </div>
      <div className="release-visual" aria-label={`${release.name} interface preview`}>
        <div className="release-window-top">
          <span />
          <span />
          <span />
        </div>
        <div className="release-dashboard">
          <div className="release-sidebar">
            <i />
            <i />
            <i />
          </div>
          <div className="release-main">
            <div className="release-chart">
              {release.metrics.map(([label, value]) => (
                <div key={label}>
                  <strong>{label}</strong>
                  <span>{value}</span>
                </div>
              ))}
            </div>
            <div className="release-progress">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function Header({ theme, setTheme }) {
  return (
    <header className="site-header">
      <a href="#/" aria-label="Go to SHANEX home">
        <LogoMark />
      </a>
      <nav aria-label="Primary navigation">
        {siteContent.navigation.map(([label, href]) => (
          <a href={href} key={href}>{label}</a>
        ))}
      </nav>
      <ThemeToggle theme={theme} setTheme={setTheme} />
    </header>
  );
}

function HomePage() {
  useScrollScenes();

  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow">
            <Sparkles size={16} />
            {siteContent.hero.eyebrow}
          </div>
          <h1>
            <span>{siteContent.hero.titleLead}</span>
            <strong>{siteContent.hero.titleStrong}</strong>
          </h1>
          <p>{siteContent.hero.description}</p>
          <div className="hero-pills" aria-label="SHANEX strengths">
            {siteContent.hero.pills.map((pill) => (
              <span key={pill}>{pill}</span>
            ))}
          </div>
          <div className="hero-actions">
            <a className="primary-action" href="#/contact">
              {siteContent.hero.primaryAction} <ArrowUpRight size={18} />
            </a>
            <a className="secondary-action" href="#services">{siteContent.hero.secondaryAction}</a>
          </div>
        </div>
        <div className="hero-showcase">
          <HeroCard />
        </div>
      </section>

      <section className="marquee" aria-label="SHANEX capabilities">
        <div>
          {siteContent.marquee.map((item) => (
            <React.Fragment key={item}>
              <span>{item}</span>
              <i />
            </React.Fragment>
          ))}
        </div>
      </section>

      <ScrollStory />

      <section id="services" className="section services-section">
        <div className="section-heading">
          <span className="number">{siteContent.servicesIntro.number}</span>
          <h2>{siteContent.servicesIntro.title}</h2>
          <p>{siteContent.servicesIntro.description}</p>
        </div>
        <div className="service-grid">
          {siteContent.services.map((service, index) => (
            <ServiceCard service={service} index={index} key={service.title} />
          ))}
        </div>
      </section>

      <section id="studio" className="section studio-section">
        <div className="studio-visual">
          <div className="layer-stack">
            <span />
            <span />
            <span />
          </div>
          <div className="mini-interface">
            <div className="mini-line wide" />
            <div className="mini-line" />
            <div className="mini-grid">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
        <div className="studio-copy">
          <span className="number">{siteContent.studio.number}</span>
          <h2>{siteContent.studio.title}</h2>
          <p>{siteContent.studio.description}</p>
          <div className="feature-list">
            {siteContent.studio.features.map(([label, Icon]) => (
              <div key={label}><Icon size={20} />{label}</div>
            ))}
          </div>
        </div>
      </section>

      <section id="releases" className="section releases-section">
        <div className="section-heading">
          <span className="number">{siteContent.releasesIntro.number}</span>
          <h2>{siteContent.releasesIntro.title}</h2>
          <p>{siteContent.releasesIntro.description}</p>
        </div>
        <div className="release-grid">
          {siteContent.releases.map((release) => (
            <ReleaseCard release={release} key={release.name} />
          ))}
        </div>
      </section>

      <section id="process" className="section process-section">
        <div className="section-heading compact">
          <span className="number">{siteContent.processIntro.number}</span>
          <h2>{siteContent.processIntro.title}</h2>
        </div>
        <div className="process-track">
          {siteContent.process.map(([title, text], index) => (
            <article key={title} className="process-step">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section faq-section" aria-labelledby="faq-title">
        <div className="section-heading compact">
          <span className="number">{siteContent.faqsIntro.number}</span>
          <h2 id="faq-title">{siteContent.faqsIntro.title}</h2>
        </div>
        <div className="faq-grid">
          {siteContent.faqs.map(([question, answer]) => (
            <article className="faq-card" key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </article>
          ))}
        </div>
      </section>

      <ContactBand />
    </main>
  );
}

function PageHero({ eyebrow, title, description }) {
  return (
    <section className="page-hero">
      <div className="eyebrow">
        <Sparkles size={16} />
        {eyebrow}
      </div>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}

function AboutPage() {
  const page = siteContent.aboutPage;
  return (
    <main>
      <PageHero {...page} />
      <section className="page-section split-page-section">
        <div className="page-panel">
          <h2>What SHANEX focuses on</h2>
          <p>
            The studio connects brand communication with practical delivery. That means the same standard is applied to
            visuals, websites, software screens, print files and final handover.
          </p>
        </div>
        <div className="stats-grid">
          {page.stats.map(([value, label]) => (
            <div className="stat-card" key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="page-section card-grid three">
        {page.values.map(([title, text]) => (
          <article className="info-card" key={title}>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

function DownloadsPage() {
  const page = siteContent.downloadsPage;
  return (
    <main>
      <PageHero {...page} />
      <section className="page-section card-grid two">
        {page.downloads.map((item) => {
          const Icon = item.icon;
          return (
            <article className="download-card" key={item.name}>
              <div className="page-card-icon"><Icon size={24} /></div>
              <span className="status-pill">{item.status}</span>
              <h2>{item.name}</h2>
              <p>{item.description}</p>
              <div className="tag-row">
                {item.meta.map((meta) => <span key={meta}>{meta}</span>)}
              </div>
              <button className="secondary-action" type="button" disabled>
                {item.version} <Download size={18} />
              </button>
            </article>
          );
        })}
      </section>
    </main>
  );
}

const shopStoreKey = 'shanex-static-shop-store';

const defaultShopStore = {
  users: [
    {
      id: 1,
      name: 'SHANEX Admin',
      email: 'admin@shanex.com',
      password: 'admin123',
      role: 'admin',
    },
  ],
  products: [
    {
      id: 1,
      name: 'Business Launch Kit',
      description: 'Logo refinement, business card design, letterhead and social launch graphics.',
      price: 35000,
      image_url: '',
      category: 'Design',
      stock: 8,
      status: 'active',
    },
    {
      id: 2,
      name: 'Print Manager License',
      description: 'Software license and setup package for print shop workflow management.',
      price: 85000,
      image_url: '',
      category: 'Software',
      stock: 5,
      status: 'active',
    },
    {
      id: 3,
      name: 'Website Starter Package',
      description: 'A focused website setup for small businesses that need a clean online presence.',
      price: 65000,
      image_url: '',
      category: 'Web',
      stock: 6,
      status: 'active',
    },
  ],
  orders: [],
};

function getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem('shanex-shop-session') || 'null');
  } catch {
    return null;
  }
}

function storeSession(session) {
  if (!session) {
    localStorage.removeItem('shanex-shop-session');
    return;
  }
  localStorage.setItem('shanex-shop-session', JSON.stringify(session));
}

function readShopStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(shopStoreKey) || 'null');
    if (saved?.products && saved?.users && saved?.orders) return saved;
  } catch {
    // Fall back to the bundled static store when saved data is malformed.
  }

  localStorage.setItem(shopStoreKey, JSON.stringify(defaultShopStore));
  return structuredClone(defaultShopStore);
}

function writeShopStore(store) {
  localStorage.setItem(shopStoreKey, JSON.stringify(store));
}

function createStaticSession(user) {
  return {
    token: `static-${user.id}-${user.role}`,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}

function getUserFromToken(store, token) {
  const id = Number(String(token || '').split('-')[1]);
  return store.users.find((user) => user.id === id);
}

async function apiRequest(path, options = {}, token) {
  const store = readShopStore();
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  const [route, query = ''] = path.split('?');

  if (route === '/products' && method === 'GET') {
    const includeDrafts = query.includes('includeDrafts=true');
    const products = includeDrafts
      ? store.products
      : store.products.filter((product) => product.status === 'active');
    return products;
  }

  if (route === '/auth/register' && method === 'POST') {
    if (!body.name || !body.email || !body.password) throw new Error('Please fill all account fields.');
    if (store.users.some((user) => user.email.toLowerCase() === body.email.toLowerCase())) {
      throw new Error('That email is already registered.');
    }

    const user = {
      id: Date.now(),
      name: body.name,
      email: body.email,
      password: body.password,
      role: 'customer',
    };
    store.users.push(user);
    writeShopStore(store);
    return createStaticSession(user);
  }

  if (route === '/auth/login' && method === 'POST') {
    const user = store.users.find(
      (item) =>
        item.email.toLowerCase() === String(body.email || '').toLowerCase() &&
        item.password === body.password &&
        item.role === body.role,
    );
    if (!user) throw new Error('Invalid login details.');
    return createStaticSession(user);
  }

  const user = getUserFromToken(store, token);
  if (!user) throw new Error('Please login first.');

  if (route === '/orders' && method === 'GET') {
    return user.role === 'admin'
      ? store.orders
      : store.orders.filter((order) => order.customer_id === user.id);
  }

  if (route === '/orders' && method === 'POST') {
    const items = body.items || [];
    if (!items.length) throw new Error('Your cart is empty.');

    const orderItems = items.map((item) => {
      const product = store.products.find((entry) => entry.id === item.productId);
      if (!product) throw new Error('A product in your cart is no longer available.');
      if (Number(product.stock) < item.quantity) throw new Error(`${product.name} does not have enough stock.`);
      product.stock = Number(product.stock) - item.quantity;
      return {
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: item.quantity,
      };
    });

    const order = {
      id: Date.now(),
      customer_id: user.id,
      customer_name: user.name,
      customer_phone: body.customer_phone,
      shipping_address: body.shipping_address,
      notes: body.notes,
      status: 'pending',
      total: orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
      items: orderItems,
    };
    store.orders.unshift(order);
    writeShopStore(store);
    return order;
  }

  if (route === '/products' && method === 'POST') {
    if (user.role !== 'admin') throw new Error('Admin access is required.');
    const product = {
      id: Date.now(),
      ...body,
      price: Number(body.price || 0),
      stock: Number(body.stock || 0),
    };
    store.products.unshift(product);
    writeShopStore(store);
    return product;
  }

  if (route.startsWith('/products/') && method === 'DELETE') {
    if (user.role !== 'admin') throw new Error('Admin access is required.');
    const productId = Number(route.split('/').pop());
    store.products = store.products.filter((product) => product.id !== productId);
    writeShopStore(store);
    return { ok: true };
  }

  throw new Error('This action is not available in static mode.');
}

function formatPrice(value) {
  return new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function ShopPage() {
  const page = siteContent.shopPage;
  const [session, setSession] = useState(getStoredSession);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [mode, setMode] = useState('customer-login');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [checkoutForm, setCheckoutForm] = useState({ phone: '', address: '', notes: '' });
  const [productForm, setProductForm] = useState({
    name: '',
    description: '',
    price: '',
    image_url: '',
    category: 'General',
    stock: '10',
    status: 'active',
  });
  const token = session?.token;
  const isAdmin = session?.user?.role === 'admin';
  const cartTotal = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);

  const loadProducts = async () => {
    const includeDrafts = isAdmin ? '?includeDrafts=true' : '';
    const data = await apiRequest(`/products${includeDrafts}`, {}, isAdmin ? token : undefined);
    setProducts(data);
  };

  const loadOrders = async () => {
    if (!token) return;
    const data = await apiRequest('/orders', {}, token);
    setOrders(data);
  };

  useEffect(() => {
    loadProducts().catch((error) => setNotice(error.message));
  }, [isAdmin]);

  useEffect(() => {
    loadOrders().catch(() => {});
  }, [token]);

  const updateSession = (nextSession) => {
    setSession(nextSession);
    storeSession(nextSession);
  };

  const handleAuth = async (event, role, action) => {
    event.preventDefault();
    setLoading(true);
    setNotice('');

    try {
      const payload = action === 'register'
        ? authForm
        : { email: authForm.email, password: authForm.password, role };
      const data = await apiRequest(`/auth/${action}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      updateSession(data);
      setMode('customer-login');
      setNotice(`Logged in as ${data.user.name}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (product) => {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...current, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId) => {
    setCart((current) => current.filter((item) => item.id !== productId));
  };

  const submitOrder = async (event) => {
    event.preventDefault();
    if (!token) {
      setNotice('Please login as a customer before checkout.');
      return;
    }
    if (!cart.length) {
      setNotice('Your cart is empty.');
      return;
    }

    setLoading(true);
    setNotice('');
    try {
      const order = await apiRequest('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_phone: checkoutForm.phone,
          shipping_address: checkoutForm.address,
          notes: checkoutForm.notes,
          items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
        }),
      }, token);
      setCart([]);
      setCheckoutForm({ phone: '', address: '', notes: '' });
      await loadProducts();
      await loadOrders();
      setNotice(`Order #${order.id} placed successfully.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const addProduct = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice('');

    try {
      await apiRequest('/products', {
        method: 'POST',
        body: JSON.stringify(productForm),
      }, token);
      setProductForm({
        name: '',
        description: '',
        price: '',
        image_url: '',
        category: 'General',
        stock: '10',
        status: 'active',
      });
      await loadProducts();
      setNotice('Product added to the shop.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteProduct = async (productId) => {
    setLoading(true);
    setNotice('');
    try {
      await apiRequest(`/products/${productId}`, { method: 'DELETE' }, token);
      await loadProducts();
      setNotice('Product removed.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <PageHero {...page} />
      <section className="page-section shop-layout">
        <div className="shop-main">
          {notice && <div className="shop-notice">{notice}</div>}
          <div className="shop-toolbar">
            <div>
              <span className="number">SHOP</span>
              <h2>Products</h2>
            </div>
            {session ? (
              <button className="secondary-action" type="button" onClick={() => updateSession(null)}>
                Logout {session.user.name}
              </button>
            ) : (
              <div className="shop-tabs">
                <button type="button" onClick={() => setMode('customer-login')}>Customer</button>
                <button type="button" onClick={() => setMode('admin-login')}>Admin</button>
              </div>
            )}
          </div>

          <div className="shop-product-grid">
            {products.map((product) => (
              <article className="shop-card product-card" key={product.id}>
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} />
                ) : (
                  <div className="product-placeholder"><ShoppingBag size={28} /></div>
                )}
                <span className="status-pill">{product.category}</span>
                <h2>{product.name}</h2>
                <p>{product.description}</p>
                <div className="product-meta">
                  <strong>{formatPrice(product.price)}</strong>
                  <span>{product.stock} in stock</span>
                </div>
                <div className="product-actions">
                  <button className="primary-action" type="button" onClick={() => addToCart(product)}>
                    Add to cart <ShoppingCart size={18} />
                  </button>
                  {isAdmin && (
                    <button className="secondary-action danger" type="button" onClick={() => deleteProduct(product.id)}>
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!products.length && <div className="empty-state">No products found. Admin can add products from the panel.</div>}
          </div>
        </div>

        <aside className="shop-sidebar">
          {!session && (
            <form className="shop-panel" onSubmit={(event) => handleAuth(event, mode === 'admin-login' ? 'admin' : 'customer', mode === 'register' ? 'register' : 'login')}>
              <div className="panel-heading">
                {mode === 'admin-login' ? <Shield size={20} /> : mode === 'register' ? <UserPlus size={20} /> : <LogIn size={20} />}
                <h3>{mode === 'admin-login' ? 'Admin login' : mode === 'register' ? 'Create customer account' : 'Customer login'}</h3>
              </div>
              {mode === 'register' && (
                <input value={authForm.name} onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })} placeholder="Full name" />
              )}
              <input value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="Email" type="email" />
              <input value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="Password" type="password" />
              <button className="primary-action" type="submit" disabled={loading}>
                {mode === 'register' ? 'Register' : 'Login'}
              </button>
              {mode !== 'admin-login' && (
                <button className="text-button" type="button" onClick={() => setMode(mode === 'register' ? 'customer-login' : 'register')}>
                  {mode === 'register' ? 'Already have an account?' : 'Create customer account'}
                </button>
              )}
            </form>
          )}

          {isAdmin && (
            <form className="shop-panel" onSubmit={addProduct}>
              <div className="panel-heading">
                <PackagePlus size={20} />
                <h3>Add product</h3>
              </div>
              <input value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} placeholder="Product name" />
              <textarea value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} placeholder="Description" />
              <input value={productForm.price} onChange={(event) => setProductForm({ ...productForm, price: event.target.value })} placeholder="Price" type="number" min="0" />
              <input value={productForm.stock} onChange={(event) => setProductForm({ ...productForm, stock: event.target.value })} placeholder="Stock" type="number" min="0" />
              <input value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })} placeholder="Category" />
              <input value={productForm.image_url} onChange={(event) => setProductForm({ ...productForm, image_url: event.target.value })} placeholder="Image URL" />
              <select value={productForm.status} onChange={(event) => setProductForm({ ...productForm, status: event.target.value })}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
              </select>
              <button className="primary-action" type="submit" disabled={loading}>Add product</button>
            </form>
          )}

          <form className="shop-panel" onSubmit={submitOrder}>
            <div className="panel-heading">
              <ShoppingCart size={20} />
              <h3>Cart</h3>
            </div>
            {cart.map((item) => (
              <div className="cart-line" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.quantity} x {formatPrice(item.price)}</span>
                </div>
                <button type="button" onClick={() => removeFromCart(item.id)}><Trash2 size={16} /></button>
              </div>
            ))}
            {!cart.length && <p className="muted-text">Cart is empty.</p>}
            <div className="cart-total">
              <span>Total</span>
              <strong>{formatPrice(cartTotal)}</strong>
            </div>
            <input value={checkoutForm.phone} onChange={(event) => setCheckoutForm({ ...checkoutForm, phone: event.target.value })} placeholder="Phone" />
            <textarea value={checkoutForm.address} onChange={(event) => setCheckoutForm({ ...checkoutForm, address: event.target.value })} placeholder="Delivery address" />
            <textarea value={checkoutForm.notes} onChange={(event) => setCheckoutForm({ ...checkoutForm, notes: event.target.value })} placeholder="Order notes" />
            <button className="primary-action" type="submit" disabled={loading || !cart.length}>
              Place order
            </button>
          </form>

          {session && (
            <div className="shop-panel">
              <div className="panel-heading">
                <ShoppingBag size={20} />
                <h3>{isAdmin ? 'Recent orders' : 'My orders'}</h3>
              </div>
              {orders.slice(0, 6).map((order) => (
                <div className="order-line" key={order.id}>
                  <strong>#{order.id} - {formatPrice(order.total)}</strong>
                  <span>{order.status}</span>
                </div>
              ))}
              {!orders.length && <p className="muted-text">No orders yet.</p>}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function ContactPage() {
  const page = siteContent.contactPage;
  return (
    <main>
      <PageHero {...page} />
      <section className="page-section contact-page-grid">
        <div className="page-panel">
          <h2>Project information</h2>
          <p>
            Include the service you need, your expected timeline, available brand material and the best way to contact
            you. A clear first message helps prepare a useful response.
          </p>
          <a className="primary-action" href={`mailto:${siteContent.brand.email}`}>
            Email SHANEX <Mail size={18} />
          </a>
        </div>
        <div className="details-list">
          {page.details.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function ContactBand() {
  return (
    <section id="contact" className="contact-section">
      <div>
        <span className="number">{siteContent.contact.number}</span>
        <h2>{siteContent.contact.title}</h2>
      </div>
      <a className="primary-action" href="#/contact">
        Contact SHANEX <Send size={18} />
      </a>
      <div className="contact-icons" aria-hidden="true">
        <Boxes />
        <Wand2 />
        <Code2 />
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <LogoMark />
        <p>{siteContent.footer.description}</p>
      </div>
      <div className="footer-columns">
        {siteContent.footer.columns.map(([title, links]) => (
          <div className="footer-column" key={title}>
            <h3>{title}</h3>
            {links.map(([label, href], index) => (
              <a href={href} key={`${title}-${label}-${href}-${index}`}>{label}</a>
            ))}
          </div>
        ))}
      </div>
      <div className="footer-bottom">
        <span>&copy; 2026 SHANEX. All rights reserved.</span>
        <a href={`mailto:${siteContent.brand.email}`}>{siteContent.brand.email}</a>
      </div>
    </footer>
  );
}

function App() {
  const [theme, setTheme] = useTheme();
  const route = useRoute();

  const pages = {
    '/': <HomePage />,
    '/about': <AboutPage />,
    '/downloads': <DownloadsPage />,
    '/shop': <ShopPage />,
    '/contact': <ContactPage />,
  };

  return (
    <>
      <AmbientGrid />
      <Header theme={theme} setTheme={setTheme} />
      {pages[route] || <HomePage />}
      <SiteFooter />
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
