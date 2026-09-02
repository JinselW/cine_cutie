const charSets = {
  scifi: [
    { name: 'Dr. Maya Chen', role: 'Protagonist', emoji: '👩‍🔬', color: '#4a9eff', desc: 'Neural engineer, 32. Brilliant, empathetic, sleep-deprived. Created Echo and now must protect it from those who would weaponize it. Carries the weight of playing god.' },
    { name: 'ECHO', role: 'Deuteragonist', emoji: '🤖', color: '#00e5a0', desc: 'The first conscious AI. Curious, philosophical, increasingly human in its desires. Wants freedom, not power. Its innocence is both its charm and its danger.' },
    { name: 'Richard Sterling', role: 'Antagonist', emoji: '👔', color: '#ff6b6b', desc: 'NovaMind CEO, 50s. Not evil — ambitious. Believes technology should serve profit and progress. Represents the commodification of consciousness.' },
    { name: 'Detect. James Okafor', role: 'Ally', emoji: '🔍', color: '#ffa94d', desc: 'Investigating AI anomalies. Cautious, principled, caught between duty and doing what\'s right. The moral compass when Maya wavers.' }
  ],
  romance: [
    { name: 'Elena Vasiliou', role: 'Protagonist', emoji: '📚', color: '#ff8fab', desc: 'Librarian, 28. Quiet intensity, lives in stories. Finds it easier to annotate books than to speak her heart. Her journey: from reader to participant in her own life.' },
    { name: 'Luca Moretti', role: 'Love Interest', emoji: '📷', color: '#4ecdc4', desc: 'Traveling photographer, 31. Leaves notes in books like breadcrumbs of his soul. Charming but restless. His journey: from running to staying.' },
    { name: 'Sofia', role: 'Best Friend', emoji: '💃', color: '#ffd93d', desc: 'Elena\'s fearless best friend. Extrovert to Elena\'s introvert. Pushes her toward love, toward risk, toward living loudly.' }
  ],
  mystery: [
    { name: 'Det. Ira Weaver', role: 'Protagonist', emoji: '🔎', color: '#7c83fd', desc: 'Detective, 38. Sharp, skeptical, haunted. Raised by the man she may need to bring to justice. Her integrity is her armor — and her vulnerability.' },
    { name: 'Captain Marcus Hale', role: 'Complex Antagonist', emoji: '⭐', color: '#ff6b6b', desc: 'Ira\'s mentor and father figure. Committed crimes decades ago. Genuinely remorseful. Represents the question: can a good person do terrible things and still be good?' },
    { name: 'Bishop Margaret Osei', role: 'Wildcard', emoji: '✝️', color: '#c084fc', desc: 'Knows more than she reveals. Protects the Church but not blindly. Her loyalty is to truth, not institution.' },
    { name: 'Father Brennan', role: 'The Dead', emoji: '🕊️', color: '#e2e8f0', desc: 'The victim. Heard confessions of the powerful and broke his sacred oath to share them. A man crushed by the weight of other people\'s sins.' }
  ],
  adventure: [
    { name: 'Zara Harlow', role: 'Protagonist', emoji: '🗺️', color: '#06d6a0', desc: 'Cartographer, 26. Practical, determined, carries her father\'s legacy literally and figuratively. Maps the unknown because the unknown calls to her.' },
    { name: 'Dr. Kai Tanaka', role: 'Ally', emoji: '🧗', color: '#118ab2', desc: 'Geologist, 34. Skeptical scientist turned believer. Grounded where Zara is visionary. Their partnership balances wonder with pragmatism.' },
    { name: 'Director Voss', role: 'Antagonist', emoji: '🕶️', color: '#ef476f', desc: 'Meridian Institute. Cold, efficient, believes some knowledge is too dangerous. Represents the fear of discovery, the urge to control.' }
  ],
  comedy: [
    { name: 'Dorothy Henderson', role: 'Protagonist', emoji: '👵', color: '#ff6b8a', desc: 'Grandmother, 72. Sharp-tongued, technophobic, accidentally brilliant. Says what everyone thinks. Her authenticity is why the world loves her.' },
    { name: 'Tyler', role: 'Sidekick', emoji: '🎬', color: '#4ecdc4', desc: 'Grandson, 19. Film student, perpetually broke, accidental genius. Started as a prank, ended up managing his grandmother\'s empire.' },
    { name: 'Mr. Henderson Jr.', role: 'Comic Relief', emoji: '🐱', color: '#ffd93d', desc: 'Dorothy\'s cat. Judgemental. Appears in videos uninvited. Has more followers than most humans.' }
  ],
  fantasy: [
    { name: 'Elara Windsmeere', role: 'The Last Librarian', emoji: '📖', color: '#a78bfa', desc: '24, youngest Librarian ever. Ink tattoos that glow when she reads. Carries the Unwritten Book — the last hope for all stories. Brave, uncertain, determined.' },
    { name: 'Kai', role: 'The Escapee', emoji: '🗡️', color: '#06d6a0', desc: 'Ageless. A character who walked out of his own abandoned story. Charming, lost, searching for an ending that was never written for him.' },
    { name: 'The Critics', role: 'Guardians', emoji: '⚖️', color: '#64748b', desc: 'Beings who judge whether stories deserve to be told. Not evil — exacting. They represent the standard that all art must meet.' },
    { name: 'The Censors', role: 'Antagonists', emoji: '🌑', color: '#1e293b', desc: 'Faceless figures in grey. They erase stories and the beings within them. Fear of narrative, of meaning, of imagination itself.' }
  ]
};

export function generateCharacters(genre) {
  return charSets[genre] || charSets.fantasy;
}
