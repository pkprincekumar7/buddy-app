import { useMediaQuery } from '@/hooks/use-mobile';
import {
  cfs,
  linkifyUrl,
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
  card: { kind: string; title: string; caption: string; date: string };
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
  const { kind: cardKind, title: cardTitle, caption: cardCaption, date: cardDate } = card;
  const { options: backgrounds, active: activeBg, onPick: onPickBg } = background;
  const { options: destinations, active: activeDest, onPick: onPickDest } = destination;
  const { label: capLabel, value: capValue } = captionInput;
  const { label: linkLabel, url: inviteUrl, onCopy: onCopyInvite } = inviteLink;
  const { onClose, onBack } = chrome;
  const { title: sentTitle, line: sentLine } = sent;
  const isNarrowGrid = useMediaQuery('(max-width: 620px)');
  const isSmall = useMediaQuery('(max-width: 480px)');
  const fullInviteUrl = `https://${inviteUrl}`;

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
          border: '1px solid rgb(var(--instagram-pink-rgb) / .35)',
          boxShadow: '0 30px 90px rgba(8,2,10,.8)',
        }}
      >
        <ModalCloseButton
          onClick={onClose}
          color="rgb(var(--instagram-muted-rgb))"
          border="rgb(var(--instagram-pink-rgb) / .28)"
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
                    'linear-gradient(150deg,rgba(58,26,62,.95),rgb(var(--instagram-badge-b-rgb) / .95))',
                  border: '1.5px solid rgb(var(--instagram-pink-rgb) / .5)',
                }}
              >
                <InstagramIcon size={19} />
              </div>
              <div>
                <div
                  className="font-orbitron"
                  style={{
                    fontWeight: 700,
                    fontSize: cfs(17),
                    color: 'rgb(var(--instagram-bright-rgb))',
                  }}
                >
                  Share to Instagram
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontWeight: 600,
                    fontSize: cfs(13.5),
                    color: 'rgb(var(--instagram-muted-rgb))',
                  }}
                >
                  Posting as {handle}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isNarrowGrid ? '1fr' : '214px 1fr',
                gap: 22,
                marginTop: 20,
                alignItems: 'start',
              }}
            >
              <div style={isNarrowGrid ? { justifySelf: 'center' } : undefined}>
                <div
                  style={{
                    width: 214,
                    borderRadius: 18,
                    overflow: 'hidden',
                    background: backdrop,
                    border: '1px solid rgb(var(--instagram-pink-rgb) / .3)',
                    padding: '12px 16px 16px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
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
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div
                      className="orb-cyan-gradient"
                      style={{ width: 19, height: 19, borderRadius: '50%' }}
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
                      marginTop: 14,
                      position: 'relative',
                      borderRadius: 13,
                      overflow: 'hidden',
                      aspectRatio: '4/5',
                      background:
                        'linear-gradient(165deg,rgb(var(--constellation-panel-a-rgb)),rgb(var(--constellation-panel-deep-rgb)))',
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
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
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
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: cfs(6),
                            letterSpacing: '.16em',
                            textTransform: 'uppercase',
                            color: 'rgb(var(--constellation-slate-mid-rgb))',
                          }}
                        >
                          {cardDate}
                        </div>
                      </div>
                      <div>
                        <div
                          className="font-orbitron"
                          style={{
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
                            color: 'rgb(var(--constellation-caption-rgb))',
                          }}
                        >
                          {cardCaption}
                        </div>
                      </div>
                      <div
                        className="font-orbitron"
                        style={{
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
                </div>
                <div
                  style={{
                    marginTop: 10,
                    textAlign: 'center',
                    fontWeight: 700,
                    fontSize: cfs(10),
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: 'rgb(var(--instagram-meta-rgb))',
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
                    color: 'rgb(var(--instagram-label-rgb))',
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
                          background: on
                            ? 'rgb(var(--instagram-pink-rgb) / .14)'
                            : 'rgb(var(--instagram-surface-rgb) / .6)',
                          border: `1px solid ${on ? 'rgb(var(--instagram-pink-rgb) / .6)' : 'rgb(var(--instagram-pink-rgb) / .14)'}`,
                          transition: 'all .2s ease',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: cfs(13.5),
                            color: on
                              ? 'rgb(var(--instagram-bright-rgb))'
                              : 'rgb(var(--instagram-inactive-rgb))',
                          }}
                        >
                          {d.name}
                        </div>
                        <div
                          style={{
                            marginTop: 2,
                            fontWeight: 600,
                            fontSize: cfs(11.5),
                            color: 'rgb(var(--instagram-meta-rgb))',
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
                    color: 'rgb(var(--instagram-label-rgb))',
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
                        border: `2px solid ${activeBg === i ? 'rgb(var(--instagram-pink-rgb))' : 'rgb(var(--instagram-pink-rgb) / .2)'}`,
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
                    color: 'rgb(var(--instagram-label-rgb))',
                  }}
                >
                  {capLabel}
                </div>
                <div
                  className="font-rajdhani"
                  style={{
                    marginTop: 7,
                    width: '100%',
                    borderRadius: 11,
                    padding: '11px 13px',
                    background: 'rgb(var(--instagram-surface-rgb) / .85)',
                    border: '1px solid rgb(var(--instagram-pink-rgb) / .24)',
                    fontWeight: 600,
                    fontSize: cfs(14.5),
                    lineHeight: 1.5,
                    color: 'rgb(var(--instagram-bright-rgb))',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {linkifyUrl(capValue, fullInviteUrl)}
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: isSmall ? 'column' : 'row',
                    alignItems: isSmall ? 'stretch' : 'center',
                    gap: 13,
                    marginTop: 12,
                    borderRadius: 14,
                    padding: '13px 15px',
                    background: 'rgb(var(--instagram-pink-rgb) / .07)',
                    border: '1px dashed rgb(var(--instagram-pink-rgb) / .35)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13, flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 9,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgb(var(--instagram-pink-rgb) / .14)',
                        border: '1px solid rgb(var(--instagram-pink-rgb) / .3)',
                      }}
                    >
                      <LinkIcon color="rgb(var(--instagram-pink-rgb))" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: cfs(13.5),
                          color: 'rgb(var(--instagram-bright-rgb))',
                        }}
                      >
                        {linkLabel}
                      </div>
                      <div
                        style={{
                          marginTop: 1,
                          fontWeight: 600,
                          fontSize: cfs(12.5),
                          color: 'rgb(var(--instagram-meta-rgb))',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        <a
                          href={fullInviteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'inherit', textDecoration: 'underline' }}
                        >
                          {inviteUrl}
                        </a>{' '}
                        · free for any parent
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onCopyInvite}
                    style={{
                      cursor: 'pointer',
                      flexShrink: 0,
                      alignSelf: isSmall ? 'flex-end' : 'center',
                      padding: '8px 15px',
                      borderRadius: 999,
                      border: '1px solid rgb(var(--instagram-pink-rgb) / .45)',
                      background: 'transparent',
                      fontWeight: 700,
                      fontSize: cfs(10.5),
                      letterSpacing: '.14em',
                      textTransform: 'uppercase',
                      color: 'rgb(var(--instagram-cta-rgb))',
                    }}
                  >
                    Copy
                  </button>
                </div>

                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShieldIcon size={13} color="rgb(var(--instagram-note-rgb))" />
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: cfs(12),
                      color: 'rgb(var(--instagram-note-rgb))',
                    }}
                  >
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
                    className="font-rajdhani"
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '13px 28px',
                      borderRadius: 999,
                      border: 'none',
                      background:
                        'linear-gradient(135deg,rgb(var(--instagram-violet-rgb)),#c2429a 55%,rgb(var(--instagram-violet-deep-rgb)))',
                      fontWeight: 700,
                      fontSize: cfs(13),
                      letterSpacing: '.16em',
                      textTransform: 'uppercase',
                      color: 'rgb(var(--instagram-ink-rgb))',
                      boxShadow: '0 0 26px rgb(var(--instagram-pink-rgb) / .38)',
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
                background: 'rgb(var(--instagram-pink-rgb) / .14)',
                border: '1.5px solid rgb(var(--instagram-pink-rgb) / .55)',
                boxShadow: '0 0 30px rgb(var(--instagram-pink-rgb) / .25)',
              }}
            >
              <CheckTickIcon size={28} color="rgb(var(--instagram-pink-rgb))" opacity={1} />
            </div>
            <div
              className="font-orbitron"
              style={{
                marginTop: 18,
                fontWeight: 700,
                fontSize: cfs(19),
                color: 'rgb(var(--instagram-bright-rgb))',
              }}
            >
              {sentTitle}
            </div>
            <div
              style={{
                marginTop: 9,
                fontSize: cfs(15),
                fontWeight: 600,
                color: 'rgb(var(--instagram-muted-rgb))',
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
                className="font-rajdhani"
                style={{
                  cursor: 'pointer',
                  padding: '12px 30px',
                  borderRadius: 999,
                  border: '1px solid rgb(var(--instagram-pink-rgb) / .45)',
                  background: 'rgba(18,8,16,.8)',
                  fontWeight: 700,
                  fontSize: cfs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: 'rgb(var(--instagram-cta-rgb))',
                }}
              >
                Done
              </button>
              <button
                type="button"
                onClick={onBack}
                className="font-rajdhani"
                style={{
                  cursor: 'pointer',
                  padding: '12px 22px',
                  border: 'none',
                  background: 'transparent',
                  fontWeight: 700,
                  fontSize: cfs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: 'rgb(var(--instagram-meta-rgb))',
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
