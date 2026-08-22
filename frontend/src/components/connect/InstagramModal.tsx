import {
  cfs,
  type IgDest,
  InstagramIcon,
  LinkIcon,
  CheckTickIcon,
  ShieldIcon,
  ArrowRightIcon,
  ModalBackdrop,
  ModalCloseButton,
} from './shared';

interface InstagramModalProps {
  mode: 'compose' | 'sent';
  handle: string;
  childName: string;
  /** The shared card being posted — same content shown across every destination. */
  card: { kind: string; title: string; caption: string };
  backdrop: string;
  /** Background-swatch picker for the share card. */
  background: { options: string[]; active: number; onPick: (i: number) => void };
  /** Where the post is being shared to (Story, Feed, etc.). */
  destination: { options: IgDest[]; active: number; onPick: (i: number) => void };
  /** The composed caption text field — distinct from `card.caption`. */
  captionInput: { label: string; value: string };
  inviteLink: { label: string; url: string; onCopy: () => void };
  cta: string;
  ratio: string;
  onShare: () => void;
  /** Modal-level navigation, not part of any specific field above. */
  chrome: { onClose: () => void; onBack: () => void };
  /** Confirmation copy shown once mode === 'sent'. */
  sent: { title: string; line: string };
}

export default function InstagramModal({
  mode,
  handle,
  childName,
  card,
  backdrop,
  background,
  destination,
  captionInput,
  inviteLink,
  cta,
  ratio,
  onShare,
  chrome,
  sent,
}: InstagramModalProps) {
  const { kind: cardKind, title: cardTitle, caption: cardCaption } = card;
  const { options: backgrounds, active: activeBg, onPick: onPickBg } = background;
  const { options: destinations, active: activeDest, onPick: onPickDest } = destination;
  const { label: capLabel, value: capValue } = captionInput;
  const { label: linkLabel, url: inviteUrl, onCopy: onCopyInvite } = inviteLink;
  const { onClose, onBack } = chrome;
  const { title: sentTitle, line: sentLine } = sent;

  return (
    <ModalBackdrop
      gradient="radial-gradient(ellipse at 50% 40%,rgba(26,12,30,.72),rgba(4,2,8,.94) 72%)"
      onClose={onClose}
    >
      <div
        style={{
          maxWidth: 680,
          margin: '0 auto',
          borderRadius: 22,
          padding: '26px 28px 24px',
          background: 'linear-gradient(165deg,rgba(34,18,40,.97),rgba(11,7,14,.97))',
          border: '1px solid rgba(226,120,190,.35)',
          boxShadow: '0 30px 90px rgba(8,2,10,.8)',
        }}
      >
        <ModalCloseButton onClick={onClose} color="#c691b4" border="rgba(226,120,190,.28)" />

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
                  background: 'linear-gradient(150deg,rgba(58,26,62,.95),rgba(16,10,20,.95))',
                  border: '1.5px solid rgba(226,120,190,.5)',
                }}
              >
                <InstagramIcon size={19} />
              </div>
              <div>
                <div
                  style={{
                    fontFamily: 'Orbitron, sans-serif',
                    fontWeight: 700,
                    fontSize: cfs(17),
                    color: '#fbe8f5',
                  }}
                >
                  Share to Instagram
                </div>
                <div
                  style={{ marginTop: 2, fontWeight: 600, fontSize: cfs(13.5), color: '#c691b4' }}
                >
                  Posting as {handle}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '214px 1fr',
                gap: 22,
                marginTop: 20,
                alignItems: 'start',
              }}
            >
              <div>
                <div
                  style={{
                    position: 'relative',
                    width: 214,
                    aspectRatio: '9/16',
                    borderRadius: 18,
                    overflow: 'hidden',
                    background: backdrop,
                    border: '1px solid rgba(226,120,190,.3)',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 12,
                      left: 12,
                      right: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: 2.5,
                        borderRadius: 2,
                        background: 'rgba(255,255,255,.85)',
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        height: 2.5,
                        borderRadius: 2,
                        background: 'rgba(255,255,255,.28)',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      top: 26,
                      left: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                    }}
                  >
                    <div
                      style={{
                        width: 19,
                        height: 19,
                        borderRadius: '50%',
                        background:
                          'radial-gradient(circle at 35% 30%,rgb(var(--constellation-cyan-pale-rgb)),rgb(var(--constellation-cyan-rgb)) 45%,#0a5b74 100%)',
                      }}
                    />
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: cfs(9.5),
                        letterSpacing: '.06em',
                        color: 'rgba(255,255,255,.92)',
                      }}
                    >
                      {handle}
                    </div>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: 16,
                      right: 16,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      borderRadius: 13,
                      overflow: 'hidden',
                      aspectRatio: '4/5',
                      background: 'linear-gradient(165deg,#16233b,#070b15)',
                      border: '1px solid rgb(var(--constellation-gold-rgb) / .45)',
                      boxShadow: '0 14px 34px rgba(2,4,12,.6)',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        padding: 13,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
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
                            fontWeight: 700,
                            fontSize: cfs(6),
                            letterSpacing: '.2em',
                            textTransform: 'uppercase',
                            color: 'rgb(var(--constellation-gold-rgb))',
                          }}
                        >
                          {cardKind}
                        </div>
                      </div>
                      <div>
                        <div
                          style={{
                            fontFamily: 'Orbitron, sans-serif',
                            fontWeight: 900,
                            fontSize: cfs(11),
                            lineHeight: 1.2,
                            color: 'rgb(var(--constellation-cyan-palest-rgb))',
                          }}
                        >
                          {cardTitle}
                        </div>
                        <div
                          style={{
                            marginTop: 5,
                            fontWeight: 600,
                            fontSize: cfs(7.5),
                            lineHeight: 1.4,
                            color: '#b9cedb',
                          }}
                        >
                          {cardCaption}
                        </div>
                      </div>
                      <div
                        style={{
                          fontFamily: 'Orbitron, sans-serif',
                          fontWeight: 900,
                          fontSize: cfs(6),
                          letterSpacing: '.14em',
                          color: 'rgb(var(--constellation-cyan-palest-rgb))',
                        }}
                      >
                        SUPERPOWER
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: 16,
                      right: 16,
                      bottom: 50,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 9,
                      background: 'rgba(10,6,12,.78)',
                      border: '1px solid rgba(255,255,255,.35)',
                    }}
                  >
                    <LinkIcon size={9} color="rgba(255,255,255,.9)" />
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: cfs(8),
                        letterSpacing: '.12em',
                        textTransform: 'uppercase',
                        color: 'rgba(255,255,255,.95)',
                      }}
                    >
                      Join Superpower
                    </div>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: 12,
                      right: 12,
                      bottom: 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        borderRadius: 999,
                        padding: '8px 12px',
                        border: '1px solid rgba(255,255,255,.4)',
                        fontWeight: 600,
                        fontSize: cfs(9.5),
                        color: 'rgba(255,255,255,.75)',
                      }}
                    >
                      Send message
                    </div>
                    <div
                      style={{
                        width: 15,
                        height: 15,
                        borderRadius: '50%',
                        border: '1.5px solid rgba(255,255,255,.6)',
                      }}
                    />
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    textAlign: 'center',
                    fontWeight: 700,
                    fontSize: cfs(10),
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: '#9a7590',
                  }}
                >
                  {ratio}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: cfs(10.5),
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: '#a2769a',
                  }}
                >
                  Where it goes
                </div>
                <div
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 11 }}
                >
                  {destinations.map((d, i) => {
                    const on = activeDest === i;
                    return (
                      <div
                        key={d.name}
                        role="button"
                        tabIndex={0}
                        onClick={() => onPickDest(i)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') onPickDest(i);
                        }}
                        style={{
                          cursor: 'pointer',
                          borderRadius: 13,
                          padding: '12px 13px',
                          background: on ? 'rgba(226,120,190,.14)' : 'rgba(10,5,12,.6)',
                          border: `1px solid ${on ? 'rgba(226,120,190,.6)' : 'rgba(226,120,190,.14)'}`,
                          transition: 'all .2s ease',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: cfs(13.5),
                            color: on ? '#fbe8f5' : '#d7b6cd',
                          }}
                        >
                          {d.name}
                        </div>
                        <div
                          style={{
                            marginTop: 2,
                            fontWeight: 600,
                            fontSize: cfs(11.5),
                            color: '#9a7590',
                          }}
                        >
                          {d.meta}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div
                  style={{
                    marginTop: 18,
                    fontWeight: 700,
                    fontSize: cfs(10.5),
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: '#a2769a',
                  }}
                >
                  Backdrop
                </div>
                <div style={{ display: 'flex', gap: 9, marginTop: 11 }}>
                  {backgrounds.map((swatch, i) => (
                    <div
                      key={swatch}
                      role="button"
                      tabIndex={0}
                      onClick={() => onPickBg(i)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') onPickBg(i);
                      }}
                      style={{
                        cursor: 'pointer',
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        background: swatch,
                        border: `2px solid ${activeBg === i ? '#e278be' : 'rgba(226,120,190,.2)'}`,
                        transition: 'all .2s ease',
                      }}
                    />
                  ))}
                </div>

                <div
                  style={{
                    marginTop: 18,
                    fontWeight: 700,
                    fontSize: cfs(10.5),
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: '#a2769a',
                  }}
                >
                  {capLabel}
                </div>
                <div
                  style={{
                    marginTop: 7,
                    width: '100%',
                    borderRadius: 11,
                    padding: '11px 13px',
                    background: 'rgba(10,5,12,.85)',
                    border: '1px solid rgba(226,120,190,.24)',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontWeight: 600,
                    fontSize: cfs(14.5),
                    lineHeight: 1.5,
                    color: '#fbe8f5',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {capValue}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 13,
                    marginTop: 12,
                    borderRadius: 14,
                    padding: '13px 15px',
                    background: 'rgba(226,120,190,.07)',
                    border: '1px dashed rgba(226,120,190,.35)',
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
                      background: 'rgba(226,120,190,.14)',
                      border: '1px solid rgba(226,120,190,.3)',
                    }}
                  >
                    <LinkIcon color="#e278be" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: cfs(13.5), color: '#fbe8f5' }}>
                      {linkLabel}
                    </div>
                    <div
                      style={{
                        marginTop: 1,
                        fontWeight: 600,
                        fontSize: cfs(12.5),
                        color: '#9a7590',
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
                      border: '1px solid rgba(226,120,190,.45)',
                      background: 'transparent',
                      fontWeight: 700,
                      fontSize: cfs(10.5),
                      letterSpacing: '.14em',
                      textTransform: 'uppercase',
                      color: '#f0b6dc',
                    }}
                  >
                    Copy
                  </button>
                </div>

                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShieldIcon size={13} color="#8a6a82" />
                  <div style={{ fontWeight: 600, fontSize: cfs(12), color: '#8a6a82' }}>
                    {childName}&rsquo;s face and full name stay off the card.
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    marginTop: 20,
                  }}
                >
                  <button
                    type="button"
                    onClick={onShare}
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '13px 28px',
                      borderRadius: 999,
                      border: 'none',
                      background: 'linear-gradient(135deg,#f0a4d4,#c2429a 55%,#8a3fd0)',
                      fontFamily: 'Rajdhani, sans-serif',
                      fontWeight: 700,
                      fontSize: cfs(13),
                      letterSpacing: '.16em',
                      textTransform: 'uppercase',
                      color: '#1a0715',
                      boxShadow: '0 0 26px rgba(226,120,190,.38)',
                    }}
                  >
                    {cta}
                    <ArrowRightIcon />
                  </button>
                </div>
              </div>
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
                background: 'rgba(226,120,190,.14)',
                border: '1.5px solid rgba(226,120,190,.55)',
                boxShadow: '0 0 30px rgba(226,120,190,.25)',
              }}
            >
              <CheckTickIcon size={28} color="#e278be" opacity={1} />
            </div>
            <div
              style={{
                marginTop: 18,
                fontFamily: 'Orbitron, sans-serif',
                fontWeight: 700,
                fontSize: cfs(19),
                color: '#fbe8f5',
              }}
            >
              {sentTitle}
            </div>
            <div
              style={{
                marginTop: 9,
                fontSize: cfs(15),
                fontWeight: 600,
                color: '#c691b4',
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
                  border: '1px solid rgba(226,120,190,.45)',
                  background: 'rgba(18,8,16,.8)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#f0b6dc',
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
                  color: '#9a7590',
                }}
              >
                Share again
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
