import {
  cfs,
  type WaContact,
  WhatsAppIcon,
  LinkIcon,
  CheckTickIcon,
  ArrowRightIcon,
  ModalBackdrop,
  ModalCloseButton,
} from './shared';

interface WhatsAppModalProps {
  mode: 'compose' | 'sent';
  childName: string;
  title: string;
  message: string;
  onMessageChange: (v: string) => void;
  contacts: WaContact[];
  picked: number[];
  onTogglePicked: (i: number) => void;
  inviteUrl: string;
  onCopyInvite: () => void;
  onSend: () => void;
  onClose: () => void;
  sentLine: string;
}

export default function WhatsAppModal({
  mode,
  childName,
  title,
  message,
  onMessageChange,
  contacts,
  picked,
  onTogglePicked,
  inviteUrl,
  onCopyInvite,
  onSend,
  onClose,
  sentLine,
}: WhatsAppModalProps) {
  const disabled = picked.length === 0;
  const count =
    picked.length === 0
      ? 'Choose at least one'
      : `${picked.length} ${picked.length === 1 ? 'chat selected' : 'chats selected'}`;

  return (
    <ModalBackdrop
      gradient="radial-gradient(ellipse at 50% 40%,rgba(8,14,26,.72),rgba(2,3,9,.94) 72%)"
      onClose={onClose}
    >
      <div
        style={{
          maxWidth: 560,
          margin: '0 auto',
          borderRadius: 22,
          padding: '26px 28px 24px',
          background: 'linear-gradient(165deg,rgba(16,32,26,.97),rgba(7,12,14,.97))',
          border: '1px solid rgba(80,220,150,.35)',
          boxShadow: '0 30px 90px rgba(2,8,6,.8)',
        }}
      >
        <ModalCloseButton onClick={onClose} color="#8fbfa8" border="rgba(80,220,150,.28)" />

        {mode === 'compose' ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(150deg,rgba(18,42,32,.95),rgba(8,16,14,.95))',
                  border: '1.5px solid rgba(80,220,150,.5)',
                }}
              >
                <WhatsAppIcon size={19} />
              </div>
              <div>
                <div
                  style={{
                    fontFamily: 'Orbitron, sans-serif',
                    fontWeight: 700,
                    fontSize: cfs(17),
                    color: '#eafff4',
                  }}
                >
                  Share on WhatsApp
                </div>
                <div
                  style={{ marginTop: 2, fontWeight: 600, fontSize: cfs(13.5), color: '#8fbfa8' }}
                >
                  {childName}&rsquo;s card, ready to go
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
                marginTop: 20,
                borderRadius: 16,
                padding: 14,
                background: 'rgba(5,12,10,.6)',
                border: '1px solid rgba(80,220,150,.16)',
              }}
            >
              <div
                style={{
                  width: 74,
                  height: 92,
                  flexShrink: 0,
                  borderRadius: 10,
                  overflow: 'hidden',
                  position: 'relative',
                  background: 'linear-gradient(165deg,#16233b,#070b15)',
                  border: '1px solid rgb(var(--constellation-gold-rgb) / .35)',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: 'rgb(var(--constellation-gold-rgb))',
                      boxShadow: '0 0 7px rgb(var(--constellation-gold-rgb))',
                    }}
                  />
                  <div
                    style={{
                      fontFamily: 'Orbitron, sans-serif',
                      fontWeight: 900,
                      fontSize: cfs(6.5),
                      lineHeight: 1.25,
                      color: 'rgb(var(--constellation-cyan-palest-rgb))',
                    }}
                  >
                    {title}
                  </div>
                  <div
                    style={{
                      fontFamily: 'Orbitron, sans-serif',
                      fontWeight: 900,
                      fontSize: cfs(4.5),
                      letterSpacing: '.1em',
                      color: 'rgb(var(--constellation-cyan-palest-rgb) / .75)',
                    }}
                  >
                    SUPERPOWER
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: cfs(10.5),
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: '#6f9a86',
                  }}
                >
                  Message
                </div>
                <textarea
                  value={message}
                  onChange={(e) => onMessageChange(e.target.value)}
                  rows={4}
                  style={{
                    marginTop: 7,
                    width: '100%',
                    resize: 'none',
                    borderRadius: 11,
                    padding: '11px 13px',
                    background: 'rgba(4,10,8,.85)',
                    border: '1px solid rgba(80,220,150,.24)',
                    outline: 'none',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontWeight: 600,
                    fontSize: cfs(14.5),
                    lineHeight: 1.5,
                    color: '#eafff4',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 13,
                marginTop: 12,
                borderRadius: 14,
                padding: '13px 15px',
                background: 'rgba(80,220,150,.07)',
                border: '1px dashed rgba(80,220,150,.35)',
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(80,220,150,.14)',
                  border: '1px solid rgba(80,220,150,.3)',
                }}
              >
                <LinkIcon color="#57dc96" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: cfs(13.5), color: '#eafff4' }}>
                  Join Superpower link included
                </div>
                <div
                  style={{ marginTop: 1, fontWeight: 600, fontSize: cfs(12.5), color: '#7ba894' }}
                >
                  {inviteUrl} · free for any parent
                </div>
              </div>
              <button
                type="button"
                onClick={onCopyInvite}
                style={{
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: '8px 15px',
                  borderRadius: 999,
                  border: '1px solid rgba(80,220,150,.45)',
                  background: 'transparent',
                  fontWeight: 700,
                  fontSize: cfs(10.5),
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: '#a9ecc8',
                }}
              >
                Copy
              </button>
            </div>

            <div
              style={{
                marginTop: 20,
                fontWeight: 700,
                fontSize: cfs(10.5),
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                color: '#6f9a86',
              }}
            >
              Send to
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 11 }}>
              {contacts.map((c, i) => {
                const on = picked.includes(i);
                return (
                  <div
                    key={c.name}
                    role="checkbox"
                    aria-checked={on}
                    tabIndex={0}
                    onClick={() => onTogglePicked(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onTogglePicked(i);
                    }}
                    style={{
                      cursor: 'pointer',
                      display: 'grid',
                      gridTemplateColumns: '34px 1fr 20px',
                      gap: 12,
                      alignItems: 'center',
                      borderRadius: 13,
                      padding: '11px 14px',
                      background: on ? 'rgba(80,220,150,.10)' : 'rgba(5,12,10,.6)',
                      border: `1px solid ${on ? 'rgba(80,220,150,.5)' : 'rgba(80,220,150,.14)'}`,
                      transition: 'all .2s ease',
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(80,220,150,.12)',
                        border: '1px solid rgba(80,220,150,.3)',
                        fontFamily: 'Orbitron, sans-serif',
                        fontWeight: 700,
                        fontSize: cfs(12),
                        color: '#8fe3b8',
                      }}
                    >
                      {c.initials}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: cfs(14.5), color: '#eafff4' }}>
                        {c.name}
                      </div>
                      <div
                        style={{
                          marginTop: 1,
                          fontWeight: 600,
                          fontSize: cfs(12.5),
                          color: '#7ba894',
                        }}
                      >
                        {c.meta}
                      </div>
                    </div>
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: `1.5px solid ${on ? '#57dc96' : 'rgba(140,180,165,.4)'}`,
                        background: on ? '#57dc96' : 'transparent',
                        transition: 'all .2s ease',
                      }}
                    >
                      <CheckTickIcon size={11} color="#052015" opacity={on ? 1 : 0} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginTop: 22,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: cfs(12),
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: '#6f9a86',
                }}
              >
                {count}
              </div>
              <button
                type="button"
                onClick={onSend}
                disabled={disabled}
                style={{
                  cursor: disabled ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '13px 28px',
                  borderRadius: 999,
                  border: 'none',
                  background: 'linear-gradient(135deg,#57dc96,#2aa96f)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(13),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#04140d',
                  boxShadow: '0 0 26px rgba(80,220,150,.4)',
                  opacity: disabled ? 0.4 : 1,
                  pointerEvents: disabled ? 'none' : 'auto',
                }}
              >
                Send
                <ArrowRightIcon />
              </button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '14px 0 6px' }}>
            <div
              style={{
                width: 66,
                height: 66,
                margin: '0 auto',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(80,220,150,.14)',
                border: '1.5px solid rgba(80,220,150,.55)',
                boxShadow: '0 0 30px rgba(80,220,150,.25)',
              }}
            >
              <CheckTickIcon size={28} color="#57dc96" opacity={1} />
            </div>
            <div
              style={{
                marginTop: 18,
                fontFamily: 'Orbitron, sans-serif',
                fontWeight: 700,
                fontSize: cfs(19),
                color: '#eafff4',
              }}
            >
              Sent on WhatsApp
            </div>
            <div
              style={{
                marginTop: 9,
                fontSize: cfs(15),
                fontWeight: 600,
                color: '#8fbfa8',
                maxWidth: 360,
                marginLeft: 'auto',
                marginRight: 'auto',
              }}
            >
              {sentLine}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                cursor: 'pointer',
                marginTop: 22,
                padding: '12px 30px',
                borderRadius: 999,
                border: '1px solid rgba(80,220,150,.45)',
                background: 'rgba(6,16,12,.8)',
                fontFamily: 'Rajdhani, sans-serif',
                fontWeight: 700,
                fontSize: cfs(12.5),
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: '#a9ecc8',
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
