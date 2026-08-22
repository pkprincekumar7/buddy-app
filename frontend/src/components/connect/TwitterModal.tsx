import {
  cfs,
  TW_RING_CIRCUMFERENCE,
  TwitterIcon,
  LinkIcon,
  CheckTickIcon,
  ChevronDownIcon,
  ModalBackdrop,
  ModalCloseButton,
} from './shared';

interface TwitterTagOption {
  label: string;
  active: boolean;
  onToggle: () => void;
}

interface TwitterModalProps {
  mode: 'compose' | 'sent';
  handle: string;
  /** The composed tweet text — mutated only by toggling `tags`, not typed directly. */
  composer: { text: string };
  /** Reply-audience selector (Everyone / Mentioned only, etc.). */
  audienceControl: { value: string; onToggle: () => void };
  tags: TwitterTagOption[];
  /** The shared card being posted — same content shown across every destination. */
  card: { kind: string; title: string; caption: string; date: string };
  inviteLink: { url: string; onCopy: () => void };
  /** Character-count ring around the post button. */
  ring: { charsLeft: number; color: string; offset: number };
  post: { disabled: boolean; onPost: () => void };
  /** Modal-level navigation, not part of any specific field above. */
  chrome: { onClose: () => void; onBack: () => void };
  sentLine: string;
}

export default function TwitterModal({
  mode,
  handle,
  composer,
  audienceControl,
  tags,
  card,
  inviteLink,
  ring,
  post,
  chrome,
  sentLine,
}: TwitterModalProps) {
  const { text } = composer;
  const { value: audience, onToggle: onToggleAudience } = audienceControl;
  const { kind: cardKind, title: cardTitle, caption: cardCaption, date: cardDate } = card;
  const { url: inviteUrl, onCopy: onCopyInvite } = inviteLink;
  const { charsLeft: left, color: ringColor, offset: ringOffset } = ring;
  const { disabled: postDisabled, onPost } = post;
  const { onClose, onBack } = chrome;

  return (
    <ModalBackdrop
      gradient="radial-gradient(ellipse at 50% 40%,rgba(12,18,26,.72),rgba(2,4,8,.94) 72%)"
      onClose={onClose}
    >
      <div
        style={{
          maxWidth: 580,
          margin: '0 auto',
          borderRadius: 22,
          padding: '26px 28px 24px',
          background: 'linear-gradient(165deg,rgba(19,25,35,.97),rgba(7,9,14,.97))',
          border: '1px solid rgba(180,205,225,.3)',
          boxShadow: '0 30px 90px rgba(2,5,10,.8)',
        }}
      >
        <ModalCloseButton onClick={onClose} color="#9fb3c4" border="rgba(180,205,225,.24)" />

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
                  background: 'linear-gradient(150deg,rgba(28,38,52,.95),rgba(8,11,17,.95))',
                  border: '1.5px solid rgba(180,205,225,.45)',
                }}
              >
                <TwitterIcon size={18} />
              </div>
              <div>
                <div
                  style={{
                    fontFamily: 'Orbitron, sans-serif',
                    fontWeight: 700,
                    fontSize: cfs(17),
                    color: '#eaf3fa',
                  }}
                >
                  Post on Twitter
                </div>
                <div
                  style={{ marginTop: 2, fontWeight: 600, fontSize: cfs(13.5), color: '#9fb3c4' }}
                >
                  {handle}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 20,
                borderRadius: 16,
                padding: '16px 17px',
                background: 'rgba(6,9,14,.7)',
                border: '1px solid rgba(180,205,225,.14)',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 13 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background:
                      'radial-gradient(circle at 35% 30%,rgb(var(--constellation-cyan-pale-rgb)),rgb(var(--constellation-cyan-rgb)) 45%,#0a5b74 100%)',
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={onToggleAudience}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onToggleAudience();
                    }}
                    style={{
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '5px 13px',
                      borderRadius: 999,
                      border: '1px solid rgba(120,190,235,.5)',
                      fontWeight: 700,
                      fontSize: cfs(10.5),
                      letterSpacing: '.14em',
                      textTransform: 'uppercase',
                      color: '#8fd0f5',
                    }}
                  >
                    {audience}
                    <ChevronDownIcon />
                  </div>
                  <div
                    style={{
                      marginTop: 11,
                      width: '100%',
                      fontFamily: 'Rajdhani, sans-serif',
                      fontWeight: 600,
                      fontSize: cfs(17),
                      lineHeight: 1.45,
                      color: '#eaf3fa',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {text}
                  </div>

                  <div
                    style={{
                      marginTop: 6,
                      position: 'relative',
                      borderRadius: 14,
                      overflow: 'hidden',
                      aspectRatio: '16/9',
                      background: 'linear-gradient(120deg,#0e1626,#070b15)',
                      border: '1px solid rgba(180,205,225,.2)',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        padding: '16px 18px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: 'rgb(var(--constellation-gold-rgb))',
                              boxShadow: '0 0 8px rgb(var(--constellation-gold-rgb))',
                            }}
                          />
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: cfs(8.5),
                              letterSpacing: '.2em',
                              textTransform: 'uppercase',
                              color: 'rgb(var(--constellation-gold-rgb))',
                            }}
                          >
                            {cardKind}
                          </div>
                        </div>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: cfs(8.5),
                            letterSpacing: '.16em',
                            textTransform: 'uppercase',
                            color: '#7e97a8',
                          }}
                        >
                          {cardDate}
                        </div>
                      </div>
                      <div>
                        <div
                          style={{
                            fontFamily: 'Orbitron, sans-serif',
                            fontWeight: 900,
                            fontSize: cfs(17),
                            lineHeight: 1.18,
                            color: 'rgb(var(--constellation-cyan-palest-rgb))',
                            maxWidth: '82%',
                          }}
                        >
                          {cardTitle}
                        </div>
                        <div
                          style={{
                            marginTop: 7,
                            fontWeight: 600,
                            fontSize: cfs(12),
                            lineHeight: 1.4,
                            color: '#b9cedb',
                            maxWidth: '74%',
                          }}
                        >
                          {cardCaption}
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div
                          style={{
                            fontFamily: 'Orbitron, sans-serif',
                            fontWeight: 900,
                            fontSize: cfs(9.5),
                            letterSpacing: '.14em',
                            color: 'rgb(var(--constellation-cyan-palest-rgb))',
                          }}
                        >
                          SUPERPOWER
                        </div>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: cfs(8.5),
                            letterSpacing: '.14em',
                            textTransform: 'uppercase',
                            color: '#7e97a8',
                          }}
                        >
                          superpower.app
                        </div>
                      </div>
                    </div>
                  </div>
                  <div
                    style={{ marginTop: 7, fontWeight: 600, fontSize: cfs(12), color: '#7d92a4' }}
                  >
                    Card attached as an image · alt text added automatically
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      marginTop: 11,
                      borderRadius: 13,
                      padding: '12px 14px',
                      background: 'rgba(143,208,245,.06)',
                      border: '1px dashed rgba(143,208,245,.32)',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(143,208,245,.12)',
                        border: '1px solid rgba(143,208,245,.28)',
                      }}
                    >
                      <LinkIcon size={14} color="#8fd0f5" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: cfs(13), color: '#eaf3fa' }}>
                        Join Superpower link in the post
                      </div>
                      <div
                        style={{
                          marginTop: 1,
                          fontWeight: 600,
                          fontSize: cfs(12),
                          color: '#7d92a4',
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
                        padding: '7px 14px',
                        borderRadius: 999,
                        border: '1px solid rgba(143,208,245,.42)',
                        background: 'transparent',
                        fontWeight: 700,
                        fontSize: cfs(10.5),
                        letterSpacing: '.14em',
                        textTransform: 'uppercase',
                        color: '#bfe3fa',
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {tags.map((t) => (
                <div
                  key={t.label}
                  role="button"
                  tabIndex={0}
                  onClick={t.onToggle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') t.onToggle();
                  }}
                  style={{
                    cursor: 'pointer',
                    padding: '8px 14px',
                    borderRadius: 999,
                    background: t.active ? 'rgba(143,208,245,.14)' : 'rgba(6,9,14,.7)',
                    border: `1px solid ${t.active ? 'rgba(143,208,245,.55)' : 'rgba(180,205,225,.16)'}`,
                    fontWeight: 700,
                    fontSize: cfs(12),
                    letterSpacing: '.04em',
                    color: t.active ? '#bfe3fa' : '#8fa5b6',
                    transition: 'all .2s ease',
                  }}
                >
                  {t.label}
                </div>
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid rgba(180,205,225,.14)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ position: 'relative', width: 26, height: 26, flexShrink: 0 }}>
                  <svg
                    viewBox="0 0 36 36"
                    style={{ width: 26, height: 26, transform: 'rotate(-90deg)' }}
                  >
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="rgba(180,205,225,.2)"
                      strokeWidth={3.4}
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke={ringColor}
                      strokeWidth={3.4}
                      strokeLinecap="round"
                      strokeDasharray={TW_RING_CIRCUMFERENCE}
                      strokeDashoffset={ringOffset}
                    />
                  </svg>
                </div>
                <div style={{ fontWeight: 700, fontSize: cfs(13), color: ringColor }}>{left}</div>
              </div>
              <button
                type="button"
                onClick={onPost}
                disabled={postDisabled}
                style={{
                  cursor: postDisabled ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '13px 30px',
                  borderRadius: 999,
                  border: 'none',
                  background: 'linear-gradient(135deg,#eaf3fa,#a9c4d8)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(13),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#0a1017',
                  boxShadow: '0 0 26px rgba(180,205,225,.25)',
                  opacity: postDisabled ? 0.4 : 1,
                  pointerEvents: postDisabled ? 'none' : 'auto',
                }}
              >
                Post
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
                background: 'rgba(180,205,225,.12)',
                border: '1.5px solid rgba(180,205,225,.5)',
                boxShadow: '0 0 30px rgba(180,205,225,.2)',
              }}
            >
              <CheckTickIcon size={28} color="#cfe1ee" opacity={1} />
            </div>
            <div
              style={{
                marginTop: 18,
                fontFamily: 'Orbitron, sans-serif',
                fontWeight: 700,
                fontSize: cfs(19),
                color: '#eaf3fa',
              }}
            >
              Posted on Twitter
            </div>
            <div
              style={{
                marginTop: 9,
                fontSize: cfs(15),
                fontWeight: 600,
                color: '#9fb3c4',
                maxWidth: 380,
                marginLeft: 'auto',
                marginRight: 'auto',
              }}
            >
              {sentLine}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                marginTop: 22,
              }}
            >
              <button
                type="button"
                onClick={onClose}
                style={{
                  cursor: 'pointer',
                  padding: '12px 30px',
                  borderRadius: 999,
                  border: '1px solid rgba(180,205,225,.4)',
                  background: 'rgba(10,14,20,.8)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#cfe1ee',
                }}
              >
                Done
              </button>
              <button
                type="button"
                onClick={onBack}
                style={{
                  cursor: 'pointer',
                  padding: '12px 22px',
                  border: 'none',
                  background: 'transparent',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#7d92a4',
                }}
              >
                Edit and repost
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
