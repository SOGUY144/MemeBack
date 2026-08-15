/**
 * A closed list of memes Gen Alpha/early-secondary Thai students actually
 * recognize (curated by the teacher this app is built for). The AI picks at
 * most one entry per answer (see STORYBOARD_SYSTEM in server/ai.ts) so the
 * Giphy search in server/giphy.ts can look for *that specific meme* instead
 * of a generic action tag — "เด็กตอบ 'ทุ่งทุ่งตีฉลาม' ควรได้ Tralalero Tralala
 * ไม่ใช่มีมสุ่ม" was the original ask.
 *
 * `query` strings were checked against the live Giphy API, not guessed —
 * several of the newest 2025 "Italian brainrot" characters (Ballerina
 * Cappuccina, Tralalero Tralala) have thin/noisy Giphy coverage no matter how
 * the query is worded; that's a library-content gap, not a query problem.
 * Established memes (Sigma, Rizz, Tung Tung Tung Sahur, classic reaction
 * templates) matched reliably.
 */
export type MemeCatalogEntry = {
  id: string;
  /** Shown to the model as the canonical name of this meme. */
  name: string;
  /** Short Thai gloss of the vibe/action this meme fits, for matching. */
  hint: string;
  /** Giphy search query, tuned against the live API. */
  query: string;
  /**
   * English visual description for server/image-gen.ts, set only on the
   * "Italian brainrot" cast (animal/object mashups born from AI image
   * generators). Ownership of internet-native meme characters like these is
   * genuinely unclear — some may still have an original creator or copyright
   * interest even without a credited studio — so this is NOT a copyright-free
   * pass. The risk reduction is in how image-gen.ts uses this field: it
   * describes general recognizable traits (a shark-humanoid in sneakers on a
   * beach) for an ORIGINAL reinterpretation, and is explicitly told never to
   * copy an exact reference image, pose, composition, distinctive design
   * detail, brand logo, or trademark. Left unset for anything referencing a
   * real copyrighted character, franchise, or public figure (Pikachu,
   * Naruto, Homelander, The Rock, ...) — gpt-image-1 shouldn't be asked to
   * render those at all, so image-gen falls back to a generic, non-infringing
   * scene description for those entries instead.
   */
  visual?: string;
};

export const MEME_CATALOG: MemeCatalogEntry[] = [
  // --- brainrot / slang, level A ---
  { id: 'six_seven', name: '67 / Six Seven', hint: 'ตอบกวน ๆ ไม่มีเหตุผล แต่ดันถูก', query: 'six seven brainrot meme' },
  { id: 'italian_brainrot', name: 'Italian Brainrot', hint: 'ไร้สาระแบบอิตาเลียนเบรนรอตทั่วไป', query: 'italian brainrot meme' },
  {
    id: 'tralalero_tralala',
    name: 'Tralalero Tralala',
    hint: 'ฉลามใส่รองเท้า',
    query: 'tralalero tralala shark',
    visual:
      'a great white shark standing upright on two muscular human-like legs wearing generic blue athletic sneakers with no visible logos or brand marks, walking confidently along a sunny beach with ocean waves behind it',
  },
  {
    id: 'tung_tung_sahur',
    name: 'Tung Tung Tung Sahur',
    hint: 'ตัวไม้ถือไม้เบสบอล',
    query: 'tung tung sahur wooden bat italian brainrot',
    visual:
      'a tall narrow humanoid figure carved from a wooden slit-drum (kentongan), simple carved face, holding a wooden drumstick/bat, standing upright at night',
  },
  {
    id: 'ballerina_cappuccina',
    name: 'Ballerina Cappuccina',
    hint: 'นักบัลเลต์หัวแก้วกาแฟ',
    query: 'ballerina cappuccina italian brainrot',
    visual:
      'a ballerina whose head is a giant cappuccino cup with latte-art foam swirl on top, wearing a pink tutu, mid-pirouette on a stage',
  },
  {
    id: 'bombardiro_crocodilo',
    name: 'Bombardiro Crocodilo',
    hint: 'เครื่องบินหัวจระเข้',
    query: 'bombardiro crocodilo italian brainrot',
    visual:
      'a large crocodile fused with the front fuselage, wings, and propellers of a WWII bomber airplane, flying low over the ocean',
  },
  {
    id: 'chimpanzini_bananini',
    name: 'Chimpanzini Bananini',
    hint: 'ลิงผสมกล้วย',
    query: 'chimpanzini bananini italian brainrot',
    visual:
      'a chimpanzee whose lower body is a giant peeled banana instead of legs, swinging through jungle trees',
  },
  {
    id: 'lirili_larila',
    name: 'Lirili Larila',
    hint: 'ช้างผสมกระบองเพชร',
    query: 'lirili larila italian brainrot',
    visual:
      'an elephant fused with a tall saguaro cactus growing out of its back in place of a howdah, standing in a desert at sunset',
  },
  {
    id: 'bombombini_gusini',
    name: 'Bombombini Gusini',
    hint: 'ห่านผสมเครื่องบิน',
    query: 'bombombini gusini italian brainrot',
    visual: 'a goose fused with the body, wings, and jet engines of a fighter jet, flying through clouds',
  },
  {
    id: 'cappuccino_assassino',
    name: 'Cappuccino Assassino',
    hint: 'นักฆ่ากาแฟ',
    query: 'cappuccino assassino italian brainrot',
    visual:
      'a cappuccino cup with latte-art foam, wearing a black ninja hood and holding a small dagger, crouched in a stealthy pose',
  },
  { id: 'skibidi_toilet', name: 'Skibidi Toilet', hint: 'หัวโผล่จากโถส้วม', query: 'skibidi toilet meme' },
  { id: 'sigma', name: 'Sigma / Sigma Boy', hint: 'เท่แบบเดียวดาย ไม่แคร์ใคร', query: 'sigma meme' },
  { id: 'rizz', name: 'Rizz', hint: 'สกิลจีบหรือเสน่ห์', query: 'rizz meme' },
  { id: 'ohio', name: 'Ohio', hint: 'เหตุการณ์ประหลาดเกินจริง', query: 'only in ohio meme' },
  { id: 'aura', name: 'Aura / Aura Points', hint: 'ทำอะไรเท่ ได้คะแนนความเท่', query: 'aura points meme' },
  { id: 'negative_aura', name: 'Negative Aura', hint: 'ทำอะไรเปิ่นจนเสียความเท่', query: 'negative aura meme' },
  { id: 'npc', name: 'NPC', hint: 'คนที่ทำอะไรซ้ำ ๆ ไม่คิดเอง เหมือนตัวละครเกม', query: 'npc meme' },
  { id: 'bro_skull', name: 'Bro 💀', hint: 'อึ้งกับสิ่งที่อีกฝ่ายทำ', query: 'bro reaction meme skull' },
  { id: 'let_him_cook', name: 'Let Him Cook', hint: 'ปล่อยให้เขาทำต่อ อาจมีของ', query: 'let him cook meme' },
  { id: 'not_cooking', name: 'Bro Is Not Cooking', hint: 'ทำต่อไปก็ไม่น่ารอด', query: 'this ain’t it bro not cooking meme' },
  { id: 'cooked', name: 'Cooked', hint: 'จบแล้ว ซวยแล้ว หมดทางแก้', query: 'we are cooked meme' },
  { id: 'chat_are_we_cooked', name: 'Chat, Are We Cooked?', hint: 'ถามเพื่อนว่าพวกเราจบหรือยัง', query: 'chat are we cooked meme' },
  { id: 'delulu', name: 'Delulu', hint: 'มโนหรือหลอกตัวเอง', query: 'delulu meme' },
  { id: 'sus', name: 'Sus / Among Us', hint: 'น่าสงสัย', query: 'sus among us meme' },
  { id: 'mewing', name: 'Mewing', hint: 'ทำกรามคมและห้ามพูด', query: 'mewing meme' },
  { id: 'looksmaxxing', name: 'Looksmaxxing', hint: 'พยายามอัปเกรดหน้าตา', query: 'looksmaxxing meme' },
  { id: 'brainrot', name: 'Brainrot', hint: 'คอนเทนต์ไร้สาระแต่หยุดดูไม่ได้', query: 'brainrot meme' },
  { id: 'fanum_tax', name: 'Fanum Tax', hint: 'แย่งอาหารเพื่อนกิน', query: 'fanum tax meme' },
  { id: 'no_cap', name: 'No Cap', hint: 'พูดจริง ไม่โกหก', query: 'no cap meme' },
  { id: 'cap', name: 'Cap', hint: 'โม้หรือโกหก', query: 'cap lying meme' },

  // --- games ---
  { id: 'roblox_oof', name: 'Roblox Oof', hint: 'ตัวละครล้มตาย', query: 'roblox oof death meme' },
  { id: 'roblox_bacon_hair', name: 'Roblox Bacon Hair', hint: 'ตัวละครมือใหม่', query: 'roblox bacon hair meme' },
  { id: 'steal_a_brainrot', name: 'Steal a Brainrot', hint: 'เกม Roblox แนวสะสม/ขโมยของ', query: 'steal a brainrot roblox meme' },
  { id: 'grow_a_garden', name: 'Grow a Garden', hint: 'เกม Roblox ปลูกสวน', query: 'grow a garden roblox meme' },
  { id: 'minecraft_villager_hmm', name: 'Minecraft Villager "Hmm"', hint: 'ชาวบ้านมองเฉย ๆ', query: 'minecraft villager hmm meme' },
  { id: 'creeper_aw_man', name: 'Creeper Aw Man', hint: 'ระเบิดแล้วของพัง', query: 'minecraft creeper aw man meme' },
  { id: 'herobrine', name: 'Herobrine', hint: 'ผีในตำนานเกม Minecraft', query: 'herobrine minecraft meme' },
  { id: 'fortnite_default_dance', name: 'Fortnite Default Dance', hint: 'เต้นฉลอง', query: 'fortnite default dance meme' },
  { id: 'victory_royale', name: 'Victory Royale', hint: 'ชนะเกม', query: 'fortnite victory royale meme' },
  { id: 'gta_wasted', name: 'GTA Wasted', hint: 'ตายในเกม จบเกม', query: 'gta wasted meme' },
  { id: 'gta_here_we_go_again', name: 'GTA "Here We Go Again"', hint: 'ต้องเริ่มใหม่ วนซ้ำ', query: 'gta here we go again meme' },
  { id: 'subway_surfers', name: 'Subway Surfers Gameplay', hint: 'วิ่งหนีเรื่อย ๆ ไม่หยุด', query: 'subway surfers gameplay meme' },
  { id: 'geometry_dash_rage', name: 'Geometry Dash Rage', hint: 'พลาดซ้ำ ๆ หัวร้อน', query: 'geometry dash rage quit meme' },
  { id: 'among_us_emergency', name: 'Among Us Emergency Meeting', hint: 'เรียกประชุมด่วนจับผิด', query: 'among us emergency meeting meme' },
  { id: 'valorant_instalock', name: 'Valorant Instalock Duelist', hint: 'รีบเลือกตัวละครก่อนใคร', query: 'valorant instalock meme' },
  { id: 'valorant_bottom_frag', name: 'Valorant Bottom Frag', hint: 'ทำผลงานได้แย่ที่สุดในทีม', query: 'valorant bottom frag meme' },
  { id: 'valorant_revive_jett', name: 'Valorant Revive Me', hint: 'ขอให้เพื่อนช่วยฟื้น', query: 'valorant revive me meme' },
  { id: 'minecraft_parkour', name: 'Minecraft Parkour', hint: 'กระโดดไต่ผ่านด่าน', query: 'minecraft parkour meme' },
  { id: 'fnaf_jumpscare', name: 'FNAF Freddy Jumpscare', hint: 'ตกใจสุดขีดกะทันหัน', query: 'five nights at freddys jumpscare meme' },
  { id: 'backrooms', name: 'The Backrooms', hint: 'หลุดเข้าที่แปลกประหลาดว่างเปล่า น่ากลัวเงียบเหงา', query: 'backrooms meme' },

  // --- anime ---
  { id: 'gojo_nah_id_win', name: 'Gojo "Nah, I’d Win"', hint: 'มั่นใจสุด ๆ ว่าชนะแน่นอน', query: 'gojo nah id win meme' },
  { id: 'gojo_domain', name: 'Gojo Domain Expansion', hint: 'ปลดของเก่งสุดออกมาแบบเหนือชั้น', query: 'gojo domain expansion meme' },
  { id: 'sukuna_smile', name: 'Sukuna ยิ้ม/หัวเราะ', hint: 'ยิ้มแบบน่ากลัว มั่นใจว่าเหนือกว่า', query: 'sukuna smile laugh meme' },
  { id: 'domain_expansion', name: 'Domain Expansion', hint: 'ปลดพลังพิเศษสุดออกมาแบบเหนือชั้น', query: 'domain expansion meme' },
  { id: 'naoya_hair_flip', name: 'Naoya Hair Flip', hint: 'สะบัดผมโชว์ท่าเท่', query: 'naoya hair flip meme' },
  { id: 'jojo_to_be_continued', name: 'JoJo "To Be Continued"', hint: 'จบฉากตอนตื่นเต้นค้างไว้', query: 'jojo to be continued meme' },
  { id: 'jojo_menacing', name: 'JoJo Menacing', hint: 'ท่าทางคุกคาม กดดันคู่ต่อสู้', query: 'jojo menacing meme' },
  { id: 'dio_it_was_me', name: 'Dio "It Was Me, Dio!"', hint: 'เฉลยว่าตัวเองคือคนก่อเรื่อง', query: 'it was me dio meme' },
  { id: 'one_piece_is_real', name: 'One Piece Is Real', hint: 'สิ่งที่ตามหามีอยู่จริง', query: 'one piece is real meme' },
  { id: 'luffy_gear5', name: 'Luffy Gear 5 Laugh', hint: 'ปลดพลังเต็มที่แบบสนุกสนาน', query: 'luffy gear 5 meme' },
  { id: 'zoro_lost', name: 'Zoro หลงทาง', hint: 'หลงทางทั้งที่ตั้งใจไปอีกทาง', query: 'zoro lost meme' },
  { id: 'naruto_run', name: 'Naruto Run', hint: 'วิ่งพุ่งไปข้างหน้าอย่างเร็ว', query: 'naruto run meme' },
  { id: 'naruto_talk_no_jutsu', name: 'Naruto Talk no Jutsu', hint: 'ใช้คำพูดเปลี่ยนใจคู่ต่อสู้', query: 'naruto talk no jutsu meme' },
  { id: 'sasuke_choking', name: 'Sasuke Choking Meme', hint: 'บีบคอเพราะโมโห', query: 'sasuke choking meme' },
  { id: 'anya_heh', name: 'Anya "Heh" (Spy x Family)', hint: 'อมยิ้มกวน ๆ รู้ทันแต่ไม่บอก', query: 'anya spy family heh meme' },
  { id: 'anya_shocked', name: 'Anya ตกใจ (Spy x Family)', hint: 'ตกใจสุดขีด', query: 'anya spy family shocked meme' },
  { id: 'aot_bertholdt', name: 'AOT เบอร์โทลด์มองด้านหลัง', hint: 'หันมองย้อนหลังด้วยสีหน้าตกใจ', query: 'attack on titan bertholdt meme' },
  { id: 'death_note_writing', name: 'Death Note เขียนชื่อ', hint: 'จดจ่อเขียนบางอย่างอย่างจริงจัง', query: 'death note writing meme' },
  { id: 'light_yagami_laugh', name: 'Light Yagami หัวเราะ', hint: 'หัวเราะบ้าคลั่งหลังทำสำเร็จ', query: 'light yagami laugh meme' },
  { id: 'goku_drip', name: 'Dragon Ball Drip Goku', hint: 'ตัวละครดูเท่แบบมีสไตล์', query: 'goku dragon ball meme' },

  // --- reactions ---
  { id: 'side_eye', name: 'Side Eye', hint: 'มองแรงเพราะคำตอบแปลก', query: 'side eye meme' },
  { id: 'bombastic_side_eye', name: 'Bombastic Side Eye', hint: 'มองแรงสุดขีดแบบเกินจริง', query: 'bombastic side eye meme' },
  { id: 'the_rock_eyebrow', name: 'The Rock เลิกคิ้ว', hint: 'ยกคิ้วสงสัยหรือประชด', query: 'the rock eyebrow raise meme' },
  { id: 'kevin_hart_confused', name: 'Kevin Hart มองงง', hint: 'งงสุดขีด ทำหน้าสับสน', query: 'kevin hart confused meme' },
  { id: 'pedro_pascal_laugh_cry', name: 'Pedro Pascal หัวเราะแล้วร้องไห้', hint: 'อารมณ์พลิกจากขำเป็นเศร้า', query: 'pedro pascal laughing crying meme' },
  { id: 'walter_white_fall', name: 'Walter White ล้มลง', hint: 'ทรุดตัวลงเพราะรับไม่ไหว', query: 'walter white falling meme' },
  { id: 'homelander_fake_smile', name: 'Homelander ยิ้มฝืน', hint: 'ยิ้มฝืนกลบความหงุดหงิด', query: 'homelander smile meme' },
  { id: 'homelander_clap', name: 'Homelander ปรบมือ', hint: 'ปรบมือแบบประชดหรือกดดัน', query: 'homelander clapping meme' },
  { id: 'explaining_brick_wall', name: 'Guy Explaining to a Brick Wall', hint: 'อธิบายให้ใครฟังแต่ไม่มีใครเข้าใจ', query: 'explaining to brick wall meme' },
  { id: 'black_guy_writing_fire', name: 'Black Guy Writing on Fire', hint: 'เขียนงานอย่างเดือดขยันสุดขีด', query: 'black guy writing fire meme' },
  { id: 'peak_cinema', name: 'Peak Cinema', hint: 'สิ่งที่ยอดเยี่ยมมาก', query: 'peak cinema meme' },
  { id: 'absolute_cinema', name: 'Absolute Cinema', hint: 'สิ่งที่ยอดเยี่ยมระดับตำนาน', query: 'absolute cinema meme' },
  { id: 'surprised_pikachu', name: 'Surprised Pikachu', hint: 'ตกใจทั้งที่คาดเดาได้อยู่แล้ว', query: 'surprised pikachu meme' },
  { id: 'confused_math_lady', name: 'Confused Math Lady', hint: 'งงกับตัวเลข/เหตุผลที่ซับซ้อน', query: 'confused math lady meme' },
  { id: 'woman_yelling_cat', name: 'Woman Yelling at Cat', hint: 'ทะเลาะหรือกล่าวโทษแบบดราม่า', query: 'woman yelling at cat meme' },
  { id: 'drake_hotline_bling', name: 'Drake Hotline Bling', hint: 'ไม่เอาอันหนึ่ง แต่เลือกอีกอัน', query: 'drake hotline bling meme' },
  { id: 'two_buttons', name: 'Two Buttons', hint: 'ตัดสินใจไม่ได้ระหว่างสองทาง', query: 'two buttons sweating meme' },
  { id: 'distracted_boyfriend', name: 'Distracted Boyfriend', hint: 'เขวไปสนใจอย่างอื่นแทน', query: 'distracted boyfriend meme' },
  { id: 'uno_draw_25', name: 'UNO Draw 25', hint: 'ยอมโดนลงโทษดีกว่าทำบางอย่าง', query: 'uno draw 25 meme' },
  { id: 'change_my_mind', name: 'Change My Mind', hint: 'ยืนยันความเห็นแบบท้าให้เถียง', query: 'change my mind meme' },
  { id: 'expanding_brain', name: 'Expanding Brain', hint: 'ความคิดที่ยิ่งพิเรนทร์ยิ่งดูฉลาดขึ้นเรื่อย ๆ', query: 'expanding brain meme' },
  { id: 'disaster_girl', name: 'Disaster Girl', hint: 'ยิ้มพอใจท่ามกลางความหายนะ', query: 'disaster girl meme' },
  { id: 'crying_cat', name: 'Crying Cat', hint: 'เสียใจร้องไห้', query: 'crying cat meme' },
  { id: 'thumbs_up_crying_cat', name: 'Thumbs-up Crying Cat', hint: 'ฝืนยิ้มทั้งที่เสียใจ', query: 'thumbs up crying cat meme' },
  { id: 'pop_cat', name: 'Pop Cat', hint: 'อ้าปากค้างแบบงง ๆ', query: 'pop cat meme' },
  { id: 'maxwell_cat', name: 'Maxwell the Cat', hint: 'ตื่นเต้นสุดขีดหรือขู่กร้าว', query: 'maxwell the cat meme' },
  { id: 'chill_guy', name: 'Chill Guy', hint: 'ชิลสุด ไม่แคร์อะไร', query: 'chill guy meme' },
  { id: 'nihilist_penguin', name: 'Nihilist Penguin', hint: 'มองโลกในแง่ร้ายแบบกวน ๆ', query: 'nihilist penguin meme' },
  { id: 'sad_hamster', name: 'Sad Hamster', hint: 'เศร้าหรือผิดหวังแบบน่าสงสาร', query: 'sad hamster meme' },
  { id: 'dancing_toothless', name: 'Dancing Toothless', hint: 'ดีใจจนเต้น', query: 'dancing toothless meme' },
];

export const MEME_CATALOG_BY_ID: ReadonlyMap<string, MemeCatalogEntry> = new Map(
  MEME_CATALOG.map((e) => [e.id, e]),
);

export const MEME_CATALOG_IDS = MEME_CATALOG.map((e) => e.id) as [string, ...string[]];

/** Compact one-line-per-entry listing embedded in the storyboard system prompt. */
export const MEME_CATALOG_PROMPT_LIST = MEME_CATALOG.map(
  (e) => `${e.id}: ${e.name} — ${e.hint}`,
).join('\n');
