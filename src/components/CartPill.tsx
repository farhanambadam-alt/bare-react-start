import { useCart } from '@/contexts/CartContext';
import { useNavigate } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const CartPill = () => {
  const { salon, cartCount, cartTotal } = useCart();
  const navigate = useNavigate();
  const location = useLocation();

  if (!salon || cartCount === 0) return null;

  const path = location.pathname;
  const isSalonRoute = path.startsWith('/salon/') || path.startsWith('/artist/') || path.startsWith('/at-home');
  const isOnCartSalon = path === `/salon/${salon.id}`;
  const isOnBooking = path.startsWith('/booking/');

  if (!isSalonRoute || isOnCartSalon || isOnBooking) return null;

  return (
    <div
      className="fixed z-[55] left-4 right-4 flex justify-center"
      style={{
        bottom: 'calc(var(--inset-bottom, 0px) + 88px)',
      }}
    >
      <button
        onClick={() => navigate(`/salon/${salon.id}`)}
        className="
          group flex items-center gap-3 w-full max-w-sm
          rounded-2xl py-3 px-4
          shadow-lg active:scale-[0.97]
          transition-all duration-200 ease-out
        "
        style={{
          background: 'var(--btn-gradient)',
          boxShadow: '0 8px 32px -6px rgba(0,0,0,0.35), var(--btn-shadow)',
        }}
      >
        {/* Salon thumbnail */}
        <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-white/20 flex-shrink-0">
          <img
            src={salon.image}
            alt={salon.name}
            className="w-full h-full object-cover"
            decoding="async"
            width={40}
            height={40}
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/placeholder.svg';
            }}
          />
        </div>

        {/* Info */}
        <div className="flex flex-col items-start flex-1 min-w-0">
          <span className="text-[13px] font-heading font-bold text-white leading-tight truncate w-full text-left">
            {cartCount} {cartCount === 1 ? 'service' : 'services'} · ₹{cartTotal}
          </span>
          <span className="text-[11px] text-white/60 leading-tight truncate w-full text-left">
            {salon.name}
          </span>
        </div>

        {/* CTA arrow — makes it clearly tappable */}
        <span
          className="
            flex items-center justify-center w-9 h-9 rounded-xl
            bg-white/20 group-hover:bg-white/30
            transition-colors duration-150
            flex-shrink-0
          "
        >
          <ArrowRight size={18} className="text-white" />
        </span>
      </button>
    </div>
  );
};

export default CartPill;
