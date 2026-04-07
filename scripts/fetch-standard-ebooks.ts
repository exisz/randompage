/**
 * Fetch books from Standard Ebooks, extract text, split into passages.
 * Usage: npx tsx scripts/fetch-standard-ebooks.ts
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE = "https://standardebooks.org";
const OUT_DIR = join(__dirname, "..", "src", "data");
const OUT_FILE = join(OUT_DIR, "passages.json");

// Curated list of great books on Standard Ebooks (public domain)
// Target: 100+ books → 500+ passages
const BOOKS = [
  // === Original 20 ===
  { path: "/ebooks/jane-austen/pride-and-prejudice", author: "Jane Austen", title: "Pride and Prejudice" },
  { path: "/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett", author: "Fyodor Dostoevsky", title: "Crime and Punishment" },
  { path: "/ebooks/oscar-wilde/the-picture-of-dorian-gray", author: "Oscar Wilde", title: "The Picture of Dorian Gray" },
  { path: "/ebooks/mary-shelley/frankenstein", author: "Mary Shelley", title: "Frankenstein" },
  { path: "/ebooks/franz-kafka/the-metamorphosis/david-wyllie", author: "Franz Kafka", title: "The Metamorphosis" },
  { path: "/ebooks/virginia-woolf/mrs-dalloway", author: "Virginia Woolf", title: "Mrs Dalloway" },
  { path: "/ebooks/herman-melville/moby-dick", author: "Herman Melville", title: "Moby-Dick" },
  { path: "/ebooks/charles-dickens/a-tale-of-two-cities", author: "Charles Dickens", title: "A Tale of Two Cities" },
  { path: "/ebooks/leo-tolstoy/anna-karenina/constance-garnett", author: "Leo Tolstoy", title: "Anna Karenina" },
  { path: "/ebooks/f-scott-fitzgerald/the-great-gatsby", author: "F. Scott Fitzgerald", title: "The Great Gatsby" },
  { path: "/ebooks/marcus-aurelius/meditations/george-long", author: "Marcus Aurelius", title: "Meditations" },
  { path: "/ebooks/sun-tzu/the-art-of-war/lionel-giles", author: "Sun Tzu", title: "The Art of War" },
  { path: "/ebooks/niccolo-machiavelli/the-prince/w-k-marriott", author: "Niccolò Machiavelli", title: "The Prince" },
  { path: "/ebooks/voltaire/candide/the-modern-library", author: "Voltaire", title: "Candide" },
  { path: "/ebooks/albert-camus/the-stranger/stuart-gilbert", author: "Albert Camus", title: "The Stranger" },
  { path: "/ebooks/homer/the-odyssey/william-cullen-bryant", author: "Homer", title: "The Odyssey" },
  { path: "/ebooks/plato/dialogues/benjamin-jowett", author: "Plato", title: "Dialogues" },
  { path: "/ebooks/charlotte-bronte/jane-eyre", author: "Charlotte Brontë", title: "Jane Eyre" },
  { path: "/ebooks/edgar-allan-poe/short-fiction", author: "Edgar Allan Poe", title: "Short Fiction" },
  { path: "/ebooks/h-g-wells/the-time-machine", author: "H. G. Wells", title: "The Time Machine" },
  // === Philosophy & Psychology (陛下偏好) ===
  { path: "/ebooks/friedrich-nietzsche/beyond-good-and-evil/helen-zimmern", author: "Friedrich Nietzsche", title: "Beyond Good and Evil" },
  { path: "/ebooks/friedrich-nietzsche/thus-spake-zarathustra/thomas-common", author: "Friedrich Nietzsche", title: "Thus Spake Zarathustra" },
  { path: "/ebooks/arthur-schopenhauer/the-world-as-will-and-representation/r-b-haldane_j-kemp", author: "Arthur Schopenhauer", title: "The World as Will and Representation" },
  { path: "/ebooks/epictetus/the-enchiridion/elizabeth-carter", author: "Epictetus", title: "The Enchiridion" },
  { path: "/ebooks/seneca/dialogues/aubrey-stewart", author: "Seneca", title: "Dialogues" },
  { path: "/ebooks/aristotle/the-nicomachean-ethics/f-h-peters", author: "Aristotle", title: "The Nicomachean Ethics" },
  { path: "/ebooks/william-james/the-varieties-of-religious-experience", author: "William James", title: "The Varieties of Religious Experience" },
  { path: "/ebooks/soren-kierkegaard/fear-and-trembling/c-stephen-evans_sylvia-walsh", author: "Søren Kierkegaard", title: "Fear and Trembling" },
  { path: "/ebooks/jean-jacques-rousseau/the-social-contract/g-d-h-cole", author: "Jean-Jacques Rousseau", title: "The Social Contract" },
  { path: "/ebooks/john-stuart-mill/on-liberty", author: "John Stuart Mill", title: "On Liberty" },
  // === History ===
  { path: "/ebooks/thucydides/the-history-of-the-peloponnesian-war/richard-crawley", author: "Thucydides", title: "The History of the Peloponnesian War" },
  { path: "/ebooks/julius-caesar/commentaries-on-the-gallic-war/w-a-mcdevitte_w-s-bohn", author: "Julius Caesar", title: "Commentaries on the Gallic War" },
  { path: "/ebooks/karl-marx_friedrich-engels/the-communist-manifesto/samuel-moore", author: "Karl Marx & Friedrich Engels", title: "The Communist Manifesto" },
  // === Classic Literature (more) ===
  { path: "/ebooks/jane-austen/sense-and-sensibility", author: "Jane Austen", title: "Sense and Sensibility" },
  { path: "/ebooks/jane-austen/emma", author: "Jane Austen", title: "Emma" },
  { path: "/ebooks/jane-austen/persuasion", author: "Jane Austen", title: "Persuasion" },
  { path: "/ebooks/charles-dickens/great-expectations", author: "Charles Dickens", title: "Great Expectations" },
  { path: "/ebooks/charles-dickens/oliver-twist", author: "Charles Dickens", title: "Oliver Twist" },
  { path: "/ebooks/charles-dickens/david-copperfield", author: "Charles Dickens", title: "David Copperfield" },
  { path: "/ebooks/leo-tolstoy/war-and-peace/louise-maude_aylmer-maude", author: "Leo Tolstoy", title: "War and Peace" },
  { path: "/ebooks/fyodor-dostoevsky/the-brothers-karamazov/constance-garnett", author: "Fyodor Dostoevsky", title: "The Brothers Karamazov" },
  { path: "/ebooks/fyodor-dostoevsky/notes-from-underground/constance-garnett", author: "Fyodor Dostoevsky", title: "Notes from Underground" },
  { path: "/ebooks/fyodor-dostoevsky/the-idiot/eva-martin", author: "Fyodor Dostoevsky", title: "The Idiot" },
  { path: "/ebooks/emily-bronte/wuthering-heights", author: "Emily Brontë", title: "Wuthering Heights" },
  { path: "/ebooks/george-eliot/middlemarch", author: "George Eliot", title: "Middlemarch" },
  { path: "/ebooks/thomas-hardy/tess-of-the-durbervilles", author: "Thomas Hardy", title: "Tess of the d'Urbervilles" },
  { path: "/ebooks/thomas-hardy/far-from-the-madding-crowd", author: "Thomas Hardy", title: "Far from the Madding Crowd" },
  { path: "/ebooks/gustave-flaubert/madame-bovary/eleanor-marx-aveling", author: "Gustave Flaubert", title: "Madame Bovary" },
  { path: "/ebooks/victor-hugo/les-miserables/isabel-f-hapgood", author: "Victor Hugo", title: "Les Misérables" },
  { path: "/ebooks/alexandre-dumas/the-count-of-monte-cristo/chapman-and-hall", author: "Alexandre Dumas", title: "The Count of Monte Cristo" },
  { path: "/ebooks/mark-twain/the-adventures-of-huckleberry-finn", author: "Mark Twain", title: "Adventures of Huckleberry Finn" },
  { path: "/ebooks/mark-twain/the-adventures-of-tom-sawyer", author: "Mark Twain", title: "The Adventures of Tom Sawyer" },
  { path: "/ebooks/joseph-conrad/heart-of-darkness", author: "Joseph Conrad", title: "Heart of Darkness" },
  { path: "/ebooks/joseph-conrad/lord-jim", author: "Joseph Conrad", title: "Lord Jim" },
  { path: "/ebooks/james-joyce/dubliners", author: "James Joyce", title: "Dubliners" },
  { path: "/ebooks/james-joyce/a-portrait-of-the-artist-as-a-young-man", author: "James Joyce", title: "A Portrait of the Artist as a Young Man" },
  { path: "/ebooks/virginia-woolf/to-the-lighthouse", author: "Virginia Woolf", title: "To the Lighthouse" },
  { path: "/ebooks/virginia-woolf/orlando", author: "Virginia Woolf", title: "Orlando" },
  { path: "/ebooks/d-h-lawrence/sons-and-lovers", author: "D. H. Lawrence", title: "Sons and Lovers" },
  { path: "/ebooks/e-m-forster/a-room-with-a-view", author: "E. M. Forster", title: "A Room with a View" },
  { path: "/ebooks/e-m-forster/howards-end", author: "E. M. Forster", title: "Howards End" },
  { path: "/ebooks/henry-james/the-turn-of-the-screw", author: "Henry James", title: "The Turn of the Screw" },
  { path: "/ebooks/henry-james/the-portrait-of-a-lady", author: "Henry James", title: "The Portrait of a Lady" },
  { path: "/ebooks/nathaniel-hawthorne/the-scarlet-letter", author: "Nathaniel Hawthorne", title: "The Scarlet Letter" },
  { path: "/ebooks/jack-london/the-call-of-the-wild", author: "Jack London", title: "The Call of the Wild" },
  { path: "/ebooks/jack-london/white-fang", author: "Jack London", title: "White Fang" },
  { path: "/ebooks/robert-louis-stevenson/treasure-island", author: "Robert Louis Stevenson", title: "Treasure Island" },
  { path: "/ebooks/robert-louis-stevenson/the-strange-case-of-dr-jekyll-and-mr-hyde", author: "Robert Louis Stevenson", title: "Strange Case of Dr. Jekyll and Mr. Hyde" },
  { path: "/ebooks/bram-stoker/dracula", author: "Bram Stoker", title: "Dracula" },
  { path: "/ebooks/lewis-carroll/alices-adventures-in-wonderland", author: "Lewis Carroll", title: "Alice's Adventures in Wonderland" },
  { path: "/ebooks/rudyard-kipling/the-jungle-book", author: "Rudyard Kipling", title: "The Jungle Book" },
  // === Sci-Fi & Dystopia ===
  { path: "/ebooks/h-g-wells/the-war-of-the-worlds", author: "H. G. Wells", title: "The War of the Worlds" },
  { path: "/ebooks/h-g-wells/the-invisible-man", author: "H. G. Wells", title: "The Invisible Man" },
  { path: "/ebooks/jules-verne/twenty-thousand-leagues-under-the-seas/f-p-walter", author: "Jules Verne", title: "Twenty Thousand Leagues Under the Seas" },
  { path: "/ebooks/jules-verne/around-the-world-in-eighty-days/george-makepeace-towle", author: "Jules Verne", title: "Around the World in Eighty Days" },
  // === Short Stories & Essays ===
  { path: "/ebooks/oscar-wilde/short-fiction", author: "Oscar Wilde", title: "Short Fiction" },
  { path: "/ebooks/o-henry/short-fiction", author: "O. Henry", title: "Short Fiction" },
  { path: "/ebooks/guy-de-maupassant/short-fiction/albert-m-c-mcmaster_a-e-henderson_mme-quesada_et-al", author: "Guy de Maupassant", title: "Short Fiction" },
  { path: "/ebooks/anton-chekhov/short-fiction/constance-garnett", author: "Anton Chekhov", title: "Short Fiction" },
  { path: "/ebooks/h-p-lovecraft/short-fiction", author: "H. P. Lovecraft", title: "Short Fiction" },
  { path: "/ebooks/ralph-waldo-emerson/essays", author: "Ralph Waldo Emerson", title: "Essays" },
  { path: "/ebooks/henry-david-thoreau/walden", author: "Henry David Thoreau", title: "Walden" },
  { path: "/ebooks/michel-de-montaigne/essays/charles-cotton", author: "Michel de Montaigne", title: "Essays" },
  // === Adventure & Exploration ===
  { path: "/ebooks/homer/the-iliad/william-cullen-bryant", author: "Homer", title: "The Iliad" },
  { path: "/ebooks/dante-alighieri/the-divine-comedy/henry-wadsworth-longfellow", author: "Dante Alighieri", title: "The Divine Comedy" },
  { path: "/ebooks/miguel-de-cervantes-saavedra/don-quixote/john-ormsby", author: "Miguel de Cervantes", title: "Don Quixote" },
  { path: "/ebooks/jonathan-swift/gullivers-travels", author: "Jonathan Swift", title: "Gulliver's Travels" },
  { path: "/ebooks/daniel-defoe/robinson-crusoe", author: "Daniel Defoe", title: "Robinson Crusoe" },
  // === More Modern ===
  { path: "/ebooks/edith-wharton/the-age-of-innocence", author: "Edith Wharton", title: "The Age of Innocence" },
  { path: "/ebooks/edith-wharton/the-house-of-mirth", author: "Edith Wharton", title: "The House of Mirth" },
  { path: "/ebooks/willa-cather/my-antonia", author: "Willa Cather", title: "My Ántonia" },
  { path: "/ebooks/kate-chopin/the-awakening", author: "Kate Chopin", title: "The Awakening" },
  { path: "/ebooks/ford-madox-ford/the-good-soldier", author: "Ford Madox Ford", title: "The Good Soldier" },
  { path: "/ebooks/w-somerset-maugham/of-human-bondage", author: "W. Somerset Maugham", title: "Of Human Bondage" },
  { path: "/ebooks/sinclair-lewis/main-street", author: "Sinclair Lewis", title: "Main Street" },
  { path: "/ebooks/theodore-dreiser/sister-carrie", author: "Theodore Dreiser", title: "Sister Carrie" },
  { path: "/ebooks/upton-sinclair/the-jungle", author: "Upton Sinclair", title: "The Jungle" },
  { path: "/ebooks/wilkie-collins/the-woman-in-white", author: "Wilkie Collins", title: "The Woman in White" },
  { path: "/ebooks/wilkie-collins/the-moonstone", author: "Wilkie Collins", title: "The Moonstone" },
  { path: "/ebooks/arthur-conan-doyle/the-hound-of-the-baskervilles", author: "Arthur Conan Doyle", title: "The Hound of the Baskervilles" },
  { path: "/ebooks/gaston-leroux/the-phantom-of-the-opera/alexander-teixeira-de-mattos", author: "Gaston Leroux", title: "The Phantom of the Opera" },
  // === Russian Literature ===
  { path: "/ebooks/ivan-turgenev/fathers-and-children/constance-garnett", author: "Ivan Turgenev", title: "Fathers and Children" },
  { path: "/ebooks/nikolai-gogol/dead-souls/d-j-hogarth", author: "Nikolai Gogol", title: "Dead Souls" },
  { path: "/ebooks/leo-tolstoy/the-death-of-ivan-ilyich/louise-maude_aylmer-maude", author: "Leo Tolstoy", title: "The Death of Ivan Ilyich" },
  // === Asian/Eastern Wisdom ===
  { path: "/ebooks/lao-tzu/tao-te-ching/james-legge", author: "Lao Tzu", title: "Tao Te Ching" },
  { path: "/ebooks/confucius/the-analects/william-jennings", author: "Confucius", title: "The Analects" },
];

interface Passage {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  tags: string[];
  language: "en";
}

function extractTextFromHtml(html: string): string[] {
  // Extract <p> tag contents, strip HTML tags
  const paragraphs: string[] = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pRegex.exec(html)) !== null) {
    const text = match[1]
      .replace(/<[^>]+>/g, "") // strip tags
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&rsquo;/g, "\u2019")
      .replace(/&lsquo;/g, "\u2018")
      .replace(/&rdquo;/g, "\u201D")
      .replace(/&ldquo;/g, "\u201C")
      .replace(/&mdash;/g, "\u2014")
      .replace(/&ndash;/g, "\u2013")
      .replace(/&hellip;/g, "\u2026")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 0) paragraphs.push(text);
  }
  return paragraphs;
}

function splitIntoPassages(paragraphs: string[], minLen = 100, maxLen = 600): string[] {
  const passages: string[] = [];
  let buffer = "";

  for (const p of paragraphs) {
    if (buffer.length + p.length + 1 <= maxLen) {
      buffer = buffer ? buffer + " " + p : p;
    } else {
      if (buffer.length >= minLen) {
        passages.push(buffer);
      }
      buffer = p.length <= maxLen ? p : p.slice(0, maxLen);
    }
  }
  if (buffer.length >= minLen) {
    passages.push(buffer);
  }
  return passages;
}

function pickBestPassages(passages: string[], count = 5): string[] {
  // Pick evenly distributed passages from the book
  if (passages.length <= count) return passages;
  const step = Math.floor(passages.length / count);
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(passages[i * step]);
  }
  return result;
}

async function fetchBook(bookPath: string): Promise<string | null> {
  const url = `${BASE}${bookPath}/text/single-page`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "RandomPage/1.0 (book passage extractor)" },
    });
    if (!res.ok) {
      console.error(`  ❌ ${res.status} for ${url}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.error(`  ❌ Fetch error for ${url}:`, e);
    return null;
  }
}

async function main() {
  const allPassages: Passage[] = [];
  let idCounter = 1;

  for (const book of BOOKS) {
    console.log(`📚 Fetching: ${book.title} by ${book.author}`);
    const html = await fetchBook(book.path);
    if (!html) continue;

    const paragraphs = extractTextFromHtml(html);
    console.log(`  → ${paragraphs.length} paragraphs extracted`);

    const chunks = splitIntoPassages(paragraphs);
    console.log(`  → ${chunks.length} passage candidates`);

    const best = pickBestPassages(chunks, 7);
    console.log(`  → Selected ${best.length} passages`);

    for (const text of best) {
      allPassages.push({
        id: String(idCounter++),
        text,
        bookTitle: book.title,
        author: book.author,
        tags: [],
        language: "en",
      });
    }

    // Be polite - 1s delay between requests
    await new Promise((r) => setTimeout(r, 1000));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(allPassages, null, 2));
  console.log(`\n✅ Wrote ${allPassages.length} passages to ${OUT_FILE}`);
}

main().catch(console.error);
