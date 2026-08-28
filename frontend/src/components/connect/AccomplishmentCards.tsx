import { cfs, type AccomplishmentItem } from './shared';

export function AccomplishmentCardPreview({
  kind,
  title,
  caption,
  date,
  childName,
  childAge,
  inviteUrl,
}: {
  kind: string;
  title: string;
  caption: string;
  date: string;
  childName: string;
  childAge: string;
  inviteUrl: string;
}) {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 24,
        overflow: 'hidden',
        aspectRatio: '4/5',
        background:
          'linear-gradient(165deg,rgb(var(--constellation-panel-a-rgb)),rgb(var(--constellation-panel-deep-rgb)))',
        border: '1px solid rgb(var(--constellation-gold-rgb) / .38)',
        boxShadow: '0 30px 80px rgba(2,6,15,.75)',
      }}
    >
      <svg
        viewBox="0 0 360 450"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}
      >
        <path
          d="M32 286 L100 234 L160 260 L222 198 L286 224 L330 168"
          fill="none"
          stroke="rgb(var(--constellation-gold-rgb) / .35)"
          strokeWidth={1}
        />
        <circle cx="32" cy="286" r="3" fill="rgb(var(--constellation-gold-rgb))" />
        <circle cx="100" cy="234" r="3" fill="rgb(var(--constellation-gold-rgb))" />
        <circle cx="160" cy="260" r="3" fill="rgb(var(--constellation-gold-rgb))" />
        <circle cx="222" cy="198" r="3" fill="rgb(var(--constellation-gold-rgb))" />
        <circle cx="286" cy="224" r="3" fill="rgb(var(--constellation-gold-rgb))" />
        <circle cx="330" cy="168" r="4.5" fill="rgb(var(--constellation-gold-rgb))" />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: 'rgb(var(--constellation-gold-rgb))',
                boxShadow: '0 0 12px rgb(var(--constellation-gold-rgb))',
              }}
            />
            <div
              style={{
                fontWeight: 700,
                fontSize: cfs(10),
                letterSpacing: '.24em',
                textTransform: 'uppercase',
                color: 'rgb(var(--constellation-gold-rgb))',
              }}
            >
              {kind}
            </div>
          </div>
          <div
            style={{
              fontWeight: 700,
              fontSize: cfs(10),
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              color: 'rgb(var(--constellation-slate-mid-rgb))',
            }}
          >
            {date}
          </div>
        </div>
        <div>
          <div
            style={{
              fontWeight: 700,
              fontSize: cfs(12),
              letterSpacing: '.2em',
              textTransform: 'uppercase',
              color: 'rgb(var(--constellation-slate-mid-rgb))',
            }}
          >
            {childName}
            {childAge && ` · Age ${childAge}`}
          </div>
          <div
            className="font-orbitron"
            style={{
              marginTop: 10,
              fontWeight: 900,
              fontSize: cfs(26),
              lineHeight: 1.16,
              color: 'rgb(var(--constellation-cyan-palest-rgb))',
            }}
          >
            {title}
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: cfs(15.5),
              fontWeight: 600,
              lineHeight: 1.45,
              color: 'rgb(var(--constellation-caption-rgb))',
            }}
          >
            {caption}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            paddingTop: 16,
            borderTop: '1px solid rgb(var(--constellation-gold-rgb) / .22)',
          }}
        >
          <div
            className="font-orbitron"
            style={{
              fontWeight: 900,
              fontSize: cfs(12),
              letterSpacing: '.14em',
              color: 'rgb(var(--constellation-cyan-palest-rgb))',
              whiteSpace: 'nowrap',
            }}
          >
            SUPERPOWER
          </div>
          <a
            href={`https://${inviteUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontWeight: 700,
              fontSize: cfs(9.5),
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: 'rgb(var(--constellation-gold-rgb))',
              textAlign: 'right',
              lineHeight: 1.35,
              // The invite URL is one long unbreakable token, and a flex item
              // defaults to min-width:auto — so it refused to shrink, pushed this
              // row past the card, and the card's overflow:hidden clipped the URL
              // to "…/JOIN/RAH". On a card whose whole purpose is being shared,
              // a truncated join link is a broken feature, not a cosmetic issue.
              minWidth: 0,
              overflowWrap: 'anywhere',
              textDecoration: 'none',
            }}
          >
            Join for free
            <br />
            {inviteUrl}
          </a>
        </div>
      </div>
    </div>
  );
}

export function AccomplishmentRow({
  item,
  active,
  onPick,
}: {
  item: AccomplishmentItem;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onPick();
      }}
      style={{
        cursor: 'pointer',
        display: 'grid',
        gridTemplateColumns: '38px 1fr auto',
        gap: 14,
        alignItems: 'center',
        borderRadius: 15,
        padding: '15px 17px',
        background: active
          ? 'linear-gradient(150deg,rgba(38,54,82,.9),rgba(8,13,24,.8))'
          : 'rgb(var(--constellation-card-rgb) / .6)',
        border: `1px solid ${active ? 'rgb(var(--constellation-gold-rgb) / .55)' : 'rgb(var(--constellation-cyan-rgb) / .12)'}`,
        transition: 'all .22s ease',
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'linear-gradient(150deg,rgb(var(--constellation-badge-a-rgb)),rgb(var(--constellation-badge-b-rgb)))',
          border: '1.5px solid rgb(var(--constellation-gold-rgb) / .55)',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgb(var(--constellation-gold-rgb))"
          strokeWidth={1.8}
          style={{ width: 18, height: 18 }}
        >
          <path d={item.icon} />
        </svg>
      </div>
      <div>
        <div
          style={{
            fontWeight: 700,
            fontSize: cfs(15.5),
            color: 'rgb(var(--constellation-cyan-pale-rgb))',
          }}
        >
          {item.title}
        </div>
        <div
          style={{
            marginTop: 2,
            fontWeight: 600,
            fontSize: cfs(13.5),
            color: 'rgb(var(--constellation-slate-light-rgb))',
          }}
        >
          {item.caption}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: cfs(10),
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'rgb(var(--constellation-slate-rgb))',
            whiteSpace: 'nowrap',
          }}
        >
          {item.when}
        </div>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: `1.5px solid ${active ? 'rgb(var(--constellation-gold-rgb))' : 'rgb(var(--constellation-ring-faint-rgb) / .4)'}`,
            background: active ? 'rgb(var(--constellation-gold-rgb))' : 'transparent',
            transition: 'all .2s ease',
          }}
        />
      </div>
    </div>
  );
}
