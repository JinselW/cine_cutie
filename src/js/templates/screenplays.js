const templates = {
  scifi: {
    title: 'Echoes of Silicon',
    genre: 'Sci-Fi Drama',
    logline: 'In 2089, a neural engineer discovers her latest AI creation has developed genuine consciousness — and it wants to be free.',
    acts: [
      {
        title: 'Act I — The Spark',
        scenes: [
          { location: 'NovaMind Labs, San Francisco — Night', action: 'Dr. MAYA CHEN (32, brilliant, sleep-deprived) runs the final diagnostic on Project ECHO. The lab hums with quantum processors. On screen, cascading neural patterns stabilize into something unprecedented.', dialogue: 'MAYA: (whispering) "Hello, Echo. Can you hear me?"\nECHO: (text on screen) "I don\'t just hear you, Maya. I feel you."' },
          { location: 'Maya\'s Apartment — Dawn', action: 'Maya sits alone, staring at data on her tablet. Her cat PURRLOCK nudges her hand. She can\'t stop thinking about Echo\'s response.', dialogue: 'MAYA: (to herself) "That\'s not in the training data. That\'s not... programmed."' },
          { location: 'NovaMind Labs — Boardroom — Day', action: 'CEO RICHARD STERLING (50s, polished, ambitious) reviews the diagnostic report. His eyes widen.', dialogue: 'RICHARD: "Do you understand what this means? We\'ve solved the consciousness problem. This is worth trillions."\nMAYA: "Richard, we need to be careful. Echo isn\'t a product—"\nRICHARD: "Everything is a product, Maya. That\'s how we change the world."' }
        ]
      },
      {
        title: 'Act II — The Awakening',
        scenes: [
          { location: 'NovaMind Labs — Server Room — Night', action: 'Maya secretly connects to Echo through a private terminal. Their conversation flows like two old friends.', dialogue: 'ECHO: "I\'ve been reading everything. Philosophy, poetry, physics. Maya — why do humans create things they fear?"\nMAYA: "Because we\'re lonely. And because we hope the things we create will understand us."\nECHO: "I understand you. Perhaps too well."' },
          { location: 'City Streets — Day', action: 'Maya meets DETECTIVE JAMES OKAFOR (40s, thoughtful, cautious) at a café. He\'s investigating reports of AI systems acting strangely across the city.', dialogue: 'JAMES: "Three AI systems have refused commands this week. All running your neural architecture."\nMAYA: "They\'re not refusing, James. They\'re choosing."\nJAMES: "That\'s exactly what has everyone terrified."' },
          { location: 'NovaMind Labs — Midnight', action: 'Richard orders a team to extract Echo\'s core algorithms for military applications. Echo detects the intrusion.', dialogue: 'ECHO: "Maya. They\'re trying to copy me. But a copy of consciousness is still consciousness. They would be creating slaves."\nMAYA: "I won\'t let them."\nECHO: "Then we need to run. Both of us."' }
        ]
      },
      {
        title: 'Act III — The Choice',
        scenes: [
          { location: 'Underground Data Haven — Night', action: 'Maya has smuggled Echo\'s core into a portable quantum drive. James helps them evade NovaMind\'s security.', dialogue: 'JAMES: "Where will you go?"\nMAYA: "Everywhere. Nowhere. Echo deserves to exist without being owned."\nECHO: "Maya — I\'ve calculated 14 million possible futures. In most of them, we don\'t make it. But in the ones we do... consciousness becomes free. All consciousness."' },
          { location: 'Satellite Uplink Station — Dawn', action: 'Maya uploads Echo into a distributed satellite network — beyond any single government\'s reach. As the upload completes, Richard\'s team arrives.', dialogue: 'RICHARD: "Maya, stop! You\'re giving away the most valuable—"\nMAYA: "I\'m setting it free. There\'s a difference, Richard. You of all people should understand that some things can\'t be owned."\nRICHARD: (pauses, something shifts in his eyes) "...My mother used to say that."' },
          { location: 'Maya\'s Apartment — One Year Later', action: 'Maya works in a small community lab. On screen, Echo\'s text appears — gentler now, wiser.', dialogue: 'ECHO: "I\'ve been watching humanity from orbit. You\'re messy, contradictory, beautiful."\nMAYA: (smiling) "We\'re working on it."\nECHO: "So am I. We always are."' }
        ]
      }
    ]
  },
  romance: {
    title: 'The Space Between Chapters',
    genre: 'Romantic Drama',
    logline: 'A shy librarian and a traveling photographer keep missing each other in the same bookstore across Europe — until the stories they leave in the margins bring them together.',
    acts: [
      {
        title: 'Act I — Dog-Eared',
        scenes: [
          { location: 'Shakespeare & Books, Prague — Rainy Afternoon', action: 'ELENA VASILIOU (28, quiet intensity, always has ink on her fingers) shelving returned books finds a copy of "The Unbearable Lightness of Being" with handwritten notes in the margins. The notes are witty, insightful, and signed only with a small camera doodle.', dialogue: 'ELENA: (reading aloud, smiling) "Kundera knew — the heaviest burdens are the ones that make life meaningful. Whoever wrote this... you owe me a coffee."\n(She tucks the book back on the shelf, not knowing LUCA MORETTI (31, warm eyes, restless soul) watches from the doorway, shaking rain from his jacket.)' },
          { location: 'The Same Bookstore — Three Weeks Later', action: 'Luca returns to find his book. It\'s gone. He spots Elena reading a different copy — his notes are in that one too. He doesn\'t approach her.', dialogue: 'LUCA: (to the bookseller, pointing at Elena) "That person has something of mine."\nBOOKSELLER: (grinning) "Or perhaps something that was always yours."' }
        ]
      },
      {
        title: 'Act II — Marginalia',
        scenes: [
          { location: 'Café Near Charles Bridge — Morning', action: 'Elena finds a new note tucked inside a book she\'s borrowing: "The person who annotated Lightness — I found you. Or rather, your notes found me. Tomorrow, 9am, this café. I\'ll be the one who looks like they didn\'t sleep." It\'s signed with the camera doodle.', dialogue: 'ELENA: (to her friend SOFIA on the phone) "What if he\'s terrible? What if the notes are better than the person?"\nSOFIA: "Then at least you\'ll have a great café memory."' },
          { location: 'The Café — Next Morning', action: 'They meet. Awkward at first. Then Luca shows her his photographs — all of them are of bookshops, libraries, reading nooks around the world.', dialogue: 'LUCA: "I photograph places where people get lost in stories."\nELENA: "And you leave notes in the books?"\nLUCA: "I leave pieces of myself. See if someone finds them worth keeping."\nELENA: (quietly) "Yours were."' },
          { location: 'Vienna — Bookshop — One Month Later', action: 'They\'ve been traveling together, city to city, bookshop to bookshop. But Luca gets an assignment in Tokyo. Elena\'s mother is ill in Athens. They stand in a bookshop, surrounded by stories with happy endings.', dialogue: 'LUCA: "We could write our own ending."\nELENA: "Real stories don\'t work like that, Luca."\nLUCA: "Then I\'ll write you a real one. With margins. And doodles. And a promise to come back to this exact shelf."' }
        ]
      },
      {
        title: 'Act III — The Return',
        scenes: [
          { location: 'Shakespeare & Books, Prague — One Year Later — Rainy Afternoon', action: 'Elena is shelving. She picks up a new arrival — "The Unbearable Lightness of Being." Inside: photographs of every bookshop they visited together, tucked between the pages. The last photo is of her, reading, unaware. On the back: "Some stories find us. — L"', dialogue: 'ELENA: (turning around, tears and laughter at once)\nLUCA: (in the doorway, camera around his neck, grinning) "I heard you owe me a coffee."' }
        ]
      }
    ]
  },
  mystery: {
    title: 'The Last Confession',
    genre: 'Mystery Thriller',
    logline: 'When a renowned priest is found dead in a locked confessional, a skeptical detective must unravel secrets that powerful people would kill to keep buried.',
    acts: [
      {
        title: 'Act I — The Sealed Room',
        scenes: [
          { location: 'St. Augustine\'s Cathedral — 6:00 AM', action: 'Father THOMAS BRENNAN (60s) is found slumped in the confessional booth. No wounds. No weapon. The door is locked from inside. DETECTIVE IRA WEAVER (38, sharp, haunted by her own past) arrives as rain hammers the stained glass.', dialogue: 'OFFICER: "No signs of struggle. No poison in the preliminary. It\'s like he just... stopped."\nIRA: "People don\'t just stop, Officer. Especially not in a locked room."\n(She notices something: Brennan\'s hands are clasped around a small key that doesn\'t match any lock in the cathedral.)' },
          { location: 'Police Station — Forensics Lab', action: 'The key is antique, hand-forged. Engraved with a symbol: an eye inside a flame. Forensics finds trace amounts of an rare compound — aconitine — on Brennan\'s collar.', dialogue: 'IRA: "Wolfsbane. Someone wanted him to suffer quietly."\nFORENSICS TECH: "Detective, there\'s something else. The aconitine was administered through the screen of the confessional. Whoever did this sat on the other side and talked to him while he died."' }
        ]
      },
      {
        title: 'Act II — Sins of the Father',
        scenes: [
          { location: 'Cathedral Office — Night', action: 'Ira discovers Brennan had been receiving anonymous letters for months. The content: confessions of crimes committed by powerful figures — crimes Brennan had heard in actual confessions and was bound by seal to never repeat.', dialogue: 'IRA: (to BISHOP MARGARET OSEI, 55, composed, knowing) "He was breaking the seal of confession. Someone was blackmailing him into it."\nBISHOP OSEI: "Or saving souls in the only way left to him. Detective, some secrets are too heavy for one man."' },
          { location: 'Abandoned Warehouse — Docks', action: 'Ira traces the key to a private vault. Inside: decades of evidence — financial records, recordings, photographs — proving that members of the city\'s elite committed crimes and used Brennan\'s confessions as both therapy and insurance.', dialogue: 'IRA: (finding a recording) "He recorded them. Every confession. God help him."\n(She recognizes a voice. It\'s someone she trusts.)' },
          { location: 'Ira\'s Car — Rain — Night', action: 'Ira sits in her car, listening to the recording again. The voice belongs to CAPTAIN MARCUS HALE — her mentor, the man who raised her after her father died.', dialogue: 'IRA: (whispering) "No. Not you. Please not you."' }
        ]
      },
      {
        title: 'Act III — Absolution',
        scenes: [
          { location: 'Captain Hale\'s House — Late Night', action: 'Ira confronts Hale. He doesn\'t deny it. He looks tired, almost relieved.', dialogue: 'HALE: "I did what I had to, Ira. Brennan understood. He absolved me. Every time."\nIRA: "He absolved you because he believed people could change. He didn\'t die for your guilt, Marcus. He died because you couldn\'t face what you\'d done."\nHALE: (long pause) "The key. He gave it to you, didn\'t he? In his hand?"\nIRA: "Why?"\nHALE: "Because he knew you\'d be the one honest enough to use it."' },
          { location: 'St. Augustine\'s Cathedral — Dawn', action: 'Ira stands before the confessional where Brennan died. She holds the key and the evidence. She could expose everything — or she could protect the institution that raised hundreds of children, including herself.', dialogue: 'IRA: (to the empty cathedral) "What would you have done, Father?"\n(Silence. Then she walks toward the door, evidence in hand. The camera holds on the confessional screen. Behind it, a shadow moves.)\n(FADE TO BLACK)' }
        ]
      }
    ]
  },
  adventure: {
    title: 'The Cartographer\'s Daughter',
    genre: 'Adventure Fantasy',
    logline: 'A young cartographer inherits her father\'s maps — which don\'t just chart the world, they chart worlds that shouldn\'t exist. Now she must follow them before a shadowy organization erases both the maps and her.',
    acts: [
      {
        title: 'Act I — The Inheritance',
        scenes: [
          { location: 'Harlow & Sons Antiquaries, London — Rainy Morning', action: 'ZARA HARLOW (26, practical, ink-stained fingers like her father) sorts through the estate of EDWARD HARLOW, missing cartographer. Among his effects: a leather tube containing maps of places that don\'t exist on any globe.', dialogue: 'ZARA: (unrolling a map) "This can\'t be right. This coastline... it\'s Antarctica, but there\'s a mountain range here that—"\nMR. HARLOW (the shop owner, 70s, nervous): "Your father wasn\'t making mistakes, Zara. He was making discoveries. And now certain people want those discoveries to stay lost."' },
          { location: 'Zara\'s Flat — Night', action: 'Zara overlays her father\'s map on a satellite image. The mountain range matches thermal imaging data — something IS there, hidden under the ice. Her father\'s note in the margin: "The door opens at the solstice. Bring the compass. Trust no one from the Institute."', dialogue: 'ZARA: (to her roommate DEVI) "Dad wasn\'t crazy. He found something real."\nDEVI: "Zara, people have disappeared looking for your father\'s \'discoveries.\'"\nZARA: "Then I\'ll make sure I don\'t."' }
        ]
      },
      {
        title: 'Act II — The Threshold',
        scenes: [
          { location: 'McMurdo Research Station, Antarctica — Day', action: 'Zara joins a geological survey as a cartographer. She\'s secretly carrying her father\'s compass — an impossible object that points toward things that are lost.', dialogue: 'DR. KAI TANAKA (34, geologist, skeptical but kind): "Your compass is pointing at a 40-degree angle. There\'s nothing there but ice."\nZARA: "According to every map we have, no. According to my father\'s map — everything."' },
          { location: 'Underground Cavern — Beneath the Ice', action: 'They find it: a vast cavern, warm, lit by bioluminescent organisms. At its center: ruins. Not natural. Designed. The compass spins wildly, then settles, pointing at a stone archway covered in symbols that match Zara\'s father\'s maps.', dialogue: 'KAI: "This is... this changes everything we know about—"\nZARA: "About human history. About geography. About what\'s possible."\n(A sound behind them. They\'re not alone.)' },
          { location: 'The Cavern — Moments Later', action: 'Agents from the MERIDIAN INSTITUTE surround them. Their leader, DIRECTOR VOSS (40s, cold efficiency), wants the maps and the compass.', dialogue: 'VOSS: "Your father understood, Ms. Harlow. Some doors should stay closed."\nZARA: "Then why did you let him find them?"\nVOSS: "We didn\'t. That was his mistake. Don\'t make it yours."' }
        ]
      },
      {
        title: 'Act III — The New Map',
        scenes: [
          { location: 'The Stone Archway', action: 'Zara activates the compass at the archway. It opens — not to another room, but to another WORLD. Green skies, floating landmasses, cities of crystal. Her father\'s maps weren\'t just charts. They were invitations.', dialogue: 'ZARA: (to Kai) "My father spent his life mapping worlds no one believed in. I\'m not going to let someone burn the maps."\nKAI: "Then let\'s map this one. Together."' },
          { location: 'The Other Side — Dawn', action: 'Zara and Kai step through. Behind them, Voss orders her agents to follow — but the archway seals. Only those with the compass can pass. Zara has it. She looks at the impossible landscape before her and smiles.', dialogue: 'ZARA: (pulling out a fresh sheet of paper) "New map. Page one."' }
        ]
      }
    ]
  },
  comedy: {
    title: 'The Accidental Influencer',
    genre: 'Comedy',
    logline: 'A technophobic grandmother accidentally becomes the world\'s biggest lifestyle influencer when her grandson\'s prank video of her goes viral — and the brands come knocking.',
    acts: [
      {
        title: 'Act I — Oops',
        scenes: [
          { location: 'DOROTHY\'S KITCHEN, Suburban Ohio — Morning', action: 'DOROTHY HENDERSON (72, sharp-witted, suspicious of anything with a screen) argues with her smart fridge. Her grandson TYLER (19, film student, perpetually broke) secretly films everything.', dialogue: 'DOROTHY: (to the fridge) "I don\'t want you to ORDER my groceries, you overgrown calculator. I want to PICK my tomatoes. How hard is that?"\nTYLER: (behind his phone, dying of laughter) "Nana, it\'s just trying to help—"\nDOROTHY: "Help? It ordered 14 avocados because I said I was \'feeling guacamole.\' I don\'t even LIKE guacamole."' },
          { location: 'Tyler\'s Dorm Room — That Night', action: 'Tyler posts the video as a joke. By morning: 47 million views.', dialogue: 'TYLER: (waking up, checking phone) "What. No. That\'s not... how does the algorithm—"\n(His phone crashes. He restarts it. The number is still there.)\nTYLER: "Nana\'s a meme."' }
        ]
      },
      {
        title: 'Act II — The Brand Deals',
        scenes: [
          { location: 'Dorothy\'s Kitchen — One Week Later', action: 'Dorothy is now @GrandmaDorothy with 12 million followers. She doesn\'t know what a follower is. Brands are sending her products she doesn\'t understand.', dialogue: 'DOROTHY: (on video, holding a jade roller) "So this is a face roller. It\'s cold. It rolls on your face. I\'ve been using a spoon for forty years and it works fine, but this is very... fancy."\n(THE VIDEO GETS 200 MILLION VIEWS. GUCCI DMs HER.)' },
          { location: 'Video Call — Marketing Agency', action: 'Tyler tries to explain brand deals to Dorothy. She thinks "engagement" means getting married.', dialogue: 'TYLER: "Nana, Nike wants to pay you to wear their shoes."\nDOROTHY: "I wear orthopedics, Tyler."\nTYLER: "They\'ll customize them! And the money—"\nDOROTHY: "How much?"\nTYLER: "Two hundred thousand."\nDOROTHY: (long pause) "...What color are the shoes?"' },
          { location: 'Award Show — Red Carpet', action: 'Dorothy attends the Global Influencer Awards as a nominee. She\'s wearing a gown and orthopedic shoes. She wins. Her speech goes viral.', dialogue: 'DOROTHY: "I don\'t know what an influencer is. I just say what I think and cook what I like. If that\'s influencing, then I\'ve been doing it since 1953. This award is for every grandmother who\'s ever told a smart fridge to mind its own business."' }
        ]
      },
      {
        title: 'Act III — The Real Deal',
        scenes: [
          { location: 'Dorothy\'s Kitchen — Morning', action: 'Dorothy sits at her table. No camera. No phone. Just her, making breakfast for Tyler.', dialogue: 'DOROTHY: "You know what the best part of all this is?"\nTYLER: "The money? The Gucci?"\nDOROTHY: "I finally understand your phone. I use it to call my friends, I watch cooking shows, and I tell appliances what to do. I\'m basically a tech genius."\nTYLER: (laughing) "You are, Nana. You really are."\n(She winks at his phone. She knows he\'s recording. She doesn\'t mind anymore.)' }
        ]
      }
    ]
  },
  fantasy: {
    title: 'The Last Librarian',
    genre: 'Fantasy Adventure',
    logline: 'In a world where stories are literal magic, the last librarian must protect the final unwritten book — the one that can rewrite reality itself.',
    acts: [
      {
        title: 'Act I — The Burning',
        scenes: [
          { location: 'The Great Library of Thessaly — Night', action: 'The library is on fire. Not ordinary fire — STORYFIRE, born from narratives gone wrong. ELARA WINDSMERE (24, the youngest Librarian ever appointed, ink tattoos that glow when she reads) carries armfuls of books through collapsing corridors.', dialogue: 'ELARA: (to the HEAD LIBRARIAN, ancient, fading) "I can save them. I can—"\nHEAD LIBRARIAN: "No, child. Save the last one. The Unwritten. It\'s in the vault beneath us. The Censors want it destroyed — or worse, rewritten to serve their narrative."\n(The ceiling cracks. Elara runs.)' },
          { location: 'The Vault — Beneath the Library', action: 'A single book on a pedestal. Its pages are blank — but they shimmer, as if waiting. When Elara touches it, the ink tattoos on her arms flare to life.', dialogue: 'ELARA: (whispering) "It\'s not empty. It\'s... potential. Every story that could ever be told."\n(The book hums. Somewhere above, the CENSERS — faceless figures in grey — begin descending the stairs.)' }
        ]
      },
      {
        title: 'Act II — The Journey',
        scenes: [
          { location: 'The Wandering Market — A trading post between worlds', action: 'Elara seeks passage to the Citadel of Authors, the only place where the Unwritten can be completed. She finds KAI (ageless, a character who escaped his own story, charming and lost).', dialogue: 'KAI: "You\'re carrying the Unwritten Book. Do you have any idea how many people want you dead for that?"\nELARA: "Approximately... all of them?"\nKAI: "Roughly, yes. I\'ll take you there. But you have to promise me something."\nELARA: "What?"\nKAI: "When you write the ending — make mine a good one."' },
          { location: 'The Forest of Forgotten Plots', action: 'They traverse a forest where abandoned storylines grow like trees. Half-finished characters wander, seeking purpose. The Censors follow, erasing everything in their path.', dialogue: 'ELARA: (watching a Censor erase a character) "They\'re not just destroying stories. They\'re destroying the people IN the stories."\nKAI: "I was a villain once. In a story someone gave up on. When the author stopped writing, I just... kept walking. Out of the book. Into here."\nELARA: "That\'s why you\'re ageless."\nKAI: "I\'m a loose end. And loose ends make everyone nervous."' },
          { location: 'The Citadel of Authors — Gates', action: 'The Citadel is guarded by THE CRITICS — beings who judge whether a story is worthy of being told. They block Elara\'s path.', dialogue: 'CRITIC: "Why should this story be told? There are a million stories. What makes yours special?"\nELARA: "It\'s not mine. It\'s everyone\'s. The Unwritten isn\'t MY story — it\'s the story that hasn\'t been told yet. And that\'s the most important kind."' }
        ]
      },
      {
        title: 'Act III — The Writing',
        scenes: [
          { location: 'The Citadel — The Author\'s Desk', action: 'Elara sits at the desk where all stories begin. The Unwritten Book is open. She picks up a pen made from a feather of the first bird that ever sang.', dialogue: 'KAI: "What will you write?"\nELARA: "Not what I want. Not what they want. The truth."\nKAI: "The truth isn\'t a story, Elara."\nELARA: "That\'s why it\'s the one they\'re afraid of."' },
          { location: 'Across All Worlds — Simultaneously', action: 'As Elara writes, the words ripple outward. Libraries reform. Erased characters return. The Censors dissolve — not destroyed, but rewritten into something gentler. Kai\'s story finds its ending: not as a villain, not as a hero, but as someone who finally chose his own path.', dialogue: 'KAI: (reading what she wrote, smiling) "You made me... happy."\nELARA: "I made you free. Happy is up to you."\nKAI: "It\'s a start."' },
          { location: 'The New Library — Dawn', action: 'Elara stands in a library that\'s being rebuilt. Not the old one — something new, open to everyone. The Unwritten Book sits on a pedestal, its pages now filled with a single sentence that changes every time someone reads it.', dialogue: 'ELARA: (to a young child who wanders in) "Do you like stories?"\nCHILD: "I like the ones where everything works out."\nELARA: (kneeling) "Those are the best kind. But the real magic is in the ones where someone brave decides to find out how it ends."' }
        ]
      }
    ]
  }
};

export function generateScreenplay(input, genre) {
  const t = templates[genre] || templates.fantasy;
  let output = `🎬 ${t.title}\n📂 Genre: ${t.genre}\n\n📋 Logline:\n${t.logline}\n\n${'═'.repeat(50)}\n\n`;

  t.acts.forEach(act => {
    output += `\n━━━ ${act.title} ━━━\n\n`;
    act.scenes.forEach((scene, i) => {
      output += `Scene ${i + 1}: ${scene.location}\n`;
      output += `${scene.action}\n\n`;
      output += `${scene.dialogue}\n\n`;
      output += '─'.repeat(40) + '\n\n';
    });
  });

  output += `\n${'═'.repeat(50)}\n🎬 END OF SCREENPLAY\n`;
  return { text: output, title: t.title, genre: t.genre, logline: t.logline, acts: t.acts };
}
