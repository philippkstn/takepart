import { wordKey, type SentenceView } from '@slides/shared';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useState } from 'react';

/*
 * Satz-Spiel auf dem Beamer, mit Übergängen:
 *  - Einblenden: Wörter erscheinen nacheinander, das häufigste ist hervorgehoben.
 *  - Anhängen: das gewählte Wort fliegt aus der Wolke an seinen Platz im Satz
 *    (gemeinsame layoutId) und leuchtet dort kurz auf.
 *  - Zurücknehmen: das letzte Wort blendet nach oben aus.
 *  - Satz fertig: eine Welle läuft einmal über den ganzen Satz.
 */

const EASE = [0.2, 0.8, 0.2, 1] as const;
const cloudId = (key: string) => `sentence-cloud-${key}`;
const isPunctuation = (w: string) => /^[.,;:!?…]/.test(w);

/**
 * Wörter zu Blöcken zusammenfassen: Satzzeichen hängen am vorigen Wort, damit sie
 * nie allein am Zeilenanfang stehen. Umgebrochen wird nur zwischen Blöcken.
 */
function groupWords(words: string[]): { first: number; indices: number[]; text: string; leadingPunct: boolean }[] {
  const groups: { first: number; indices: number[]; text: string; leadingPunct: boolean }[] = [];
  words.forEach((w, i) => {
    const last = groups[groups.length - 1];
    if (isPunctuation(w) && last) {
      last.text += w;
      last.indices.push(i);
    } else {
      groups.push({ first: i, indices: [i], text: w, leadingPunct: isPunctuation(w) });
    }
  });
  return groups;
}

export function SentenceStage({ slideId, sentence, answers }: { slideId: number; sentence: SentenceView; answers: number }) {
  const { appended, done, revealed, round } = sentence;
  const words = revealed ? (sentence.words ?? []) : [];
  const top = words.length > 0 ? words[0]!.count : 0;

  // Welches Wort wurde gerade angehängt? Nur dieses bekommt den Flug aus der Wolke.
  // Im Render abgeleitet (nicht im Effect), damit die layoutId schon im selben
  // Commit steht, in dem die Wolke verschwindet.
  const [prevLength, setPrevLength] = useState(appended.length);
  const [fresh, setFresh] = useState<number | null>(null);
  if (appended.length !== prevLength) {
    setPrevLength(appended.length);
    setFresh(appended.length > prevLength ? appended.length - 1 : null);
  }
  const last = appended[appended.length - 1];
  const lastKey = last ? wordKey(last) : '';

  // Große Wörter in die Mitte, kleine nach außen
  const arranged: { key: string; word: string; count: number; rank: number }[] = [];
  words.slice(0, 40).forEach((w, rank) => (rank % 2 === 0 ? arranged.push({ ...w, rank }) : arranged.unshift({ ...w, rank })));
  const max = words[0]?.count ?? 1;
  const min = words[Math.min(words.length, 40) - 1]?.count ?? 1;

  return (
    <LayoutGroup id={`sentence-${slideId}`}>
      <div className="stage-sentence">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={done ? 'done' : `round-${round}`}
            className="stage-kicker"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            {done ? 'Unser Satz' : `Satz vervollständigen · Runde ${round}`}
          </motion.span>
        </AnimatePresence>

        <motion.p layout="position" className={`sentence-big ${done ? 'is-done' : ''}`} transition={{ duration: 0.4, ease: EASE }}>
          <span className="sentence-word" style={{ ['--i' as string]: 0 }}>
            {sentence.start}
          </span>
          <AnimatePresence initial={false}>
            {groupWords(appended).map((g) => {
              const isFresh = fresh !== null && g.indices.includes(fresh);
              // Flug aus der Wolke nur, wenn das neue Wort den Block beginnt (kein angehängtes Satzzeichen)
              const flies = isFresh && g.first === fresh && lastKey;
              return (
                // Außen inline mit echtem Leerzeichen: bricht wie Text um, am Zeilenanfang kein Einzug.
                // Innen inline-block, weil Transformationen (Flug, Skalierung) nur auf Boxen wirken.
                <motion.span
                  key={g.first}
                  className="sentence-token"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.25 } }}
                  transition={{ duration: 0.35 }}
                >
                  {g.leadingPunct ? '' : ' '}
                  <motion.span
                    layoutId={flies ? cloudId(lastKey) : undefined}
                    className={`sentence-box ${isFresh ? 'is-new' : ''}`}
                    style={{ ['--i' as string]: g.first + 1 }}
                    initial={{ y: '0.35em', scale: 0.85 }}
                    animate={{ y: 0, scale: 1 }}
                    transition={{ duration: 0.55, ease: EASE }}
                  >
                    {g.text}
                  </motion.span>
                </motion.span>
              );
            })}
          </AnimatePresence>
          {!done && (
            <motion.span layout className="sentence-gap" transition={{ duration: 0.4, ease: EASE }}>
              &nbsp;
            </motion.span>
          )}
        </motion.p>

        <div className="sentence-cloud-area">
          <AnimatePresence mode="popLayout">
            {revealed && words.length > 0 ? (
              <motion.div key={`cloud-${round}`} className="sentence-cloud" exit={{ opacity: 0, transition: { duration: 0.3 } }}>
                {arranged.map((w) => {
                  const t = max === min ? 1 : (w.count - min) / (max - min);
                  const isTop = w.count === top;
                  return (
                    <motion.span
                      key={w.key}
                      layoutId={cloudId(w.key)}
                      className={`cloud-word ${isTop ? 'is-top' : ''}`}
                      style={{ fontSize: `${0.9 + t * 2.4}em` }}
                      initial={{ opacity: 0, scale: 0.6, y: 12 }}
                      animate={{ opacity: 0.55 + t * 0.45, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ duration: 0.45, ease: EASE, delay: Math.min(1.2, w.rank * 0.06) }}
                      title={`${w.word}: ${w.count}×`}
                    >
                      {w.word}
                      <sup className="cloud-count tabular">{w.count}</sup>
                    </motion.span>
                  );
                })}
              </motion.div>
            ) : (
              !done && (
                <motion.div
                  key={`wait-${round}`}
                  className="stage-waiting"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE, delay: 0.25 }}
                >
                  <span>
                    Welches Wort kommt als Nächstes? ·{' '}
                    <motion.strong
                      key={answers}
                      className="tabular"
                      initial={{ scale: 1.35 }}
                      animate={{ scale: 1 }}
                      style={{ display: 'inline-block' }}
                    >
                      {answers}
                    </motion.strong>{' '}
                    {answers === 1 ? 'Wort' : 'Wörter'}
                  </span>
                </motion.div>
              )
            )}
          </AnimatePresence>
        </div>
      </div>
    </LayoutGroup>
  );
}
