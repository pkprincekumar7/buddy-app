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
      gradient="radial-gradient(ellipse at 50% 40%,rgb(var(--constellation-overlay-rgb) / .72),rgb(var(--constellation-void-rgb) / .94) 72%)"
      onClose={onClose}
    >
      <div
        style={{
          maxWidth: 560,
          margin: '0 auto',
          borderRadius: 22,
          padding: '26px 28px 24px',
          background: 'linear-gradient(165deg,rgba(16,32,26,.97),rgba(7,12,14,.97))',
          border: '1px solid rgb(var(--whatsapp-green-rgb) / .35)',
          boxShadow: '0 30px 90px rgba(2,8,6,.8)',
        }}
      >
        <ModalCloseButton
          onClick={onClose}
          color="rgb(var(--whatsapp-muted-rgb))"
          border="rgb(var(--whatsapp-green-rgb) / .28)"
        />

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
                  background:
                    'linear-gradient(150deg,rgb(var(--whatsapp-badge-a-rgb) / .95),rgb(var(--whatsapp-badge-b-rgb) / .95))',
                  border: '1.5px solid rgb(var(--whatsapp-green-rgb) / .5)',
                }}
              >
                <WhatsAppIcon size={19} />
              </div>
              <div>
                <div
                  className="font-orbitron"
                  style={{
                    fontWeight: 700,
                    fontSize: cfs(17),
                    color: 'rgb(var(--whatsapp-text-rgb))',
                  }}
                >
                  Share on WhatsApp
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontWeight: 600,
                    fontSize: cfs(13.5),
                    color: 'rgb(var(--whatsapp-muted-rgb))',
                  }}
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
                background: 'rgb(var(--whatsapp-surface-rgb) / .6)',
                border: '1px solid rgb(var(--whatsapp-green-rgb) / .16)',
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
                  background:
                    'linear-gradient(165deg,rgb(var(--constellation-panel-a-rgb)),rgb(var(--constellation-panel-deep-rgb)))',
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
                    className="font-orbitron"
                    style={{
                      fontWeight: 900,
                      fontSize: cfs(6.5),
                      lineHeight: 1.25,
                      color: 'rgb(var(--constellation-cyan-palest-rgb))',
                    }}
                  >
                    {title}
                  </div>
                  <div
                    className="font-orbitron"
                    style={{
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
                    color: 'rgb(var(--whatsapp-label-rgb))',
                  }}
                >
                  Message
                </div>
                <div
                  className="font-rajdhani"
                  style={{
                    marginTop: 7,
                    width: '100%',
                    borderRadius: 11,
                    padding: '11px 13px',
                    background: 'rgb(var(--whatsapp-surface-rgb) / .85)',
                    border: '1px solid rgb(var(--whatsapp-green-rgb) / .24)',
                    fontWeight: 600,
                    fontSize: cfs(14.5),
                    lineHeight: 1.5,
                    color: 'rgb(var(--whatsapp-text-rgb))',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {message}
                </div>
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
                background: 'rgb(var(--whatsapp-green-rgb) / .07)',
                border: '1px dashed rgb(var(--whatsapp-green-rgb) / .35)',
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
                  background: 'rgb(var(--whatsapp-green-rgb) / .14)',
                  border: '1px solid rgb(var(--whatsapp-green-rgb) / .3)',
                }}
              >
                <LinkIcon color="rgb(var(--whatsapp-bright-rgb))" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: cfs(13.5),
                    color: 'rgb(var(--whatsapp-text-rgb))',
                  }}
                >
                  Join Superpower link included
                </div>
                <div
                  style={{
                    marginTop: 1,
                    fontWeight: 600,
                    fontSize: cfs(12.5),
                    color: 'rgb(var(--whatsapp-meta-rgb))',
                  }}
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
                  border: '1px solid rgb(var(--whatsapp-green-rgb) / .45)',
                  background: 'transparent',
                  fontWeight: 700,
                  fontSize: cfs(10.5),
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: 'rgb(var(--whatsapp-cta-rgb))',
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
                color: 'rgb(var(--whatsapp-label-rgb))',
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
                      background: on
                        ? 'rgb(var(--whatsapp-green-rgb) / .10)'
                        : 'rgb(var(--whatsapp-surface-rgb) / .6)',
                      border: `1px solid ${on ? 'rgb(var(--whatsapp-green-rgb) / .5)' : 'rgb(var(--whatsapp-green-rgb) / .14)'}`,
                      transition: 'all .2s ease',
                    }}
                  >
                    <div
                      className="font-orbitron"
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgb(var(--whatsapp-green-rgb) / .12)',
                        border: '1px solid rgb(var(--whatsapp-green-rgb) / .3)',
                        fontWeight: 700,
                        fontSize: cfs(12),
                        color: 'rgb(var(--whatsapp-initials-rgb))',
                      }}
                    >
                      {c.initials}
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: cfs(14.5),
                          color: 'rgb(var(--whatsapp-text-rgb))',
                        }}
                      >
                        {c.name}
                      </div>
                      <div
                        style={{
                          marginTop: 1,
                          fontWeight: 600,
                          fontSize: cfs(12.5),
                          color: 'rgb(var(--whatsapp-meta-rgb))',
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
                        border: `1.5px solid ${on ? 'rgb(var(--whatsapp-bright-rgb))' : 'rgb(var(--whatsapp-faint-rgb) / .4)'}`,
                        background: on ? 'rgb(var(--whatsapp-bright-rgb))' : 'transparent',
                        transition: 'all .2s ease',
                      }}
                    >
                      <CheckTickIcon
                        size={11}
                        color="rgb(var(--whatsapp-ink-deep-rgb))"
                        opacity={on ? 1 : 0}
                      />
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
                  color: 'rgb(var(--whatsapp-label-rgb))',
                }}
              >
                {count}
              </div>
              <button
                type="button"
                onClick={onSend}
                disabled={disabled}
                className="font-rajdhani"
                style={{
                  cursor: disabled ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '13px 28px',
                  borderRadius: 999,
                  border: 'none',
                  background:
                    'linear-gradient(135deg,rgb(var(--whatsapp-bright-rgb)),rgb(var(--whatsapp-dark-rgb)))',
                  fontWeight: 700,
                  fontSize: cfs(13),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: 'rgb(var(--whatsapp-ink-rgb))',
                  boxShadow: '0 0 26px rgb(var(--whatsapp-green-rgb) / .4)',
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
                background: 'rgb(var(--whatsapp-green-rgb) / .14)',
                border: '1.5px solid rgb(var(--whatsapp-green-rgb) / .55)',
                boxShadow: '0 0 30px rgb(var(--whatsapp-green-rgb) / .25)',
              }}
            >
              <CheckTickIcon size={28} color="rgb(var(--whatsapp-bright-rgb))" opacity={1} />
            </div>
            <div
              className="font-orbitron"
              style={{
                marginTop: 18,
                fontWeight: 700,
                fontSize: cfs(19),
                color: 'rgb(var(--whatsapp-text-rgb))',
              }}
            >
              Sent on WhatsApp
            </div>
            <div
              style={{
                marginTop: 9,
                fontSize: cfs(15),
                fontWeight: 600,
                color: 'rgb(var(--whatsapp-muted-rgb))',
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
              className="font-rajdhani"
              style={{
                cursor: 'pointer',
                marginTop: 22,
                padding: '12px 30px',
                borderRadius: 999,
                border: '1px solid rgb(var(--whatsapp-green-rgb) / .45)',
                background: 'rgba(6,16,12,.8)',
                fontWeight: 700,
                fontSize: cfs(12.5),
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: 'rgb(var(--whatsapp-cta-rgb))',
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
