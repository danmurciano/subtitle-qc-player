/* ==========================================================================
   Offline language detector for subtitle text.
   - Script is detected deterministically from Unicode ranges.
   - Within a script, languages are scored with high-frequency function words
     (weighted by how many languages share each word) plus distinctive letters.
   - Chinese Simplified/Traditional via character sets, Cantonese via markers.
   No network, no dependencies.
   ========================================================================== */
const Detector = (() => {

  const LANG_NAMES = {
    af:'Afrikaans', sq:'Albanian', ar:'Arabic', hy:'Armenian', az:'Azerbaijani', id:'Indonesian',
    ms:'Malay', eu:'Basque', bs:'Bosnian', bg:'Bulgarian', my:'Burmese', yue:'Cantonese',
    zh:'Chinese', hr:'Croatian', cs:'Czech', da:'Danish', prs:'Dari', nl:'Dutch', en:'English',
    et:'Estonian', fa:'Persian', fi:'Finnish', fr:'French', ga:'Irish', ka:'Georgian', de:'German',
    el:'Greek', he:'Hebrew', hi:'Hindi', hu:'Hungarian', is:'Icelandic', it:'Italian', ja:'Japanese',
    kn:'Kannada', km:'Khmer', ko:'Korean', lv:'Latvian', lt:'Lithuanian', mk:'Macedonian',
    ml:'Malayalam', mn:'Mongolian', no:'Norwegian', ps:'Pashto', pl:'Polish', pt:'Portuguese',
    ro:'Romanian', ru:'Russian', sr:'Serbian', sk:'Slovak', sl:'Slovenian', es:'Spanish',
    ca:'Catalan', sv:'Swedish', tl:'Tagalog', ta:'Tamil', te:'Telugu', th:'Thai', tr:'Turkish',
    uk:'Ukrainian', ur:'Urdu', vi:'Vietnamese', cy:'Welsh', gl:'Galician'
  };

  // Languages that cannot be told apart reliably from short subtitle text.
  const CLUSTERS = [['bs','hr','sr'], ['da','no'], ['id','ms'], ['fa','prs'], ['zh','yue']];
  function sameCluster(a, b) {
    if (a === b) return true;
    return CLUSTERS.some(c => c.includes(a) && c.includes(b));
  }

  // ---------------------------------------------------------------- scripts
  function charScript(cp) {
    if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) return 'Latn';
    if (cp >= 0xC0 && cp <= 0x24F && cp !== 0xD7 && cp !== 0xF7) return 'Latn';
    if (cp >= 0x1E00 && cp <= 0x1EFF) return 'Latn';
    if (cp === 0x259) return 'Latn';
    if ((cp >= 0x370 && cp <= 0x3FF) || (cp >= 0x1F00 && cp <= 0x1FFF)) return 'Grek';
    if (cp >= 0x400 && cp <= 0x52F) return 'Cyrl';
    if (cp >= 0x530 && cp <= 0x58F) return 'Armn';
    if (cp >= 0x590 && cp <= 0x5FF) return 'Hebr';
    if ((cp >= 0x600 && cp <= 0x6FF) || (cp >= 0x750 && cp <= 0x77F) ||
        (cp >= 0xFB50 && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF)) return 'Arab';
    if (cp >= 0x900 && cp <= 0x97F) return 'Deva';
    if (cp >= 0xB80 && cp <= 0xBFF) return 'Taml';
    if (cp >= 0xC00 && cp <= 0xC7F) return 'Telu';
    if (cp >= 0xC80 && cp <= 0xCFF) return 'Knda';
    if (cp >= 0xD00 && cp <= 0xD7F) return 'Mlym';
    if (cp >= 0xE00 && cp <= 0xE7F) return 'Thai';
    if (cp >= 0x1000 && cp <= 0x109F) return 'Mymr';
    if ((cp >= 0x10A0 && cp <= 0x10FF) || (cp >= 0x1C90 && cp <= 0x1CBF)) return 'Geor';
    if ((cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x3130 && cp <= 0x318F) || (cp >= 0xAC00 && cp <= 0xD7AF)) return 'Hang';
    if (cp >= 0x1780 && cp <= 0x17FF) return 'Khmr';
    if (cp >= 0x3040 && cp <= 0x309F) return 'Kana';
    if (cp >= 0x30A0 && cp <= 0x30FF && cp !== 0x30FB) return 'Kana';
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
        (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x20000 && cp <= 0x2FA1F)) return 'Hani';
    return null;
  }

  const SINGLE_SCRIPT_LANG = {
    Grek:'el', Armn:'hy', Hebr:'he', Deva:'hi', Taml:'ta', Telu:'te', Knda:'kn', Mlym:'ml',
    Thai:'th', Mymr:'my', Geor:'ka', Hang:'ko', Khmr:'km'
  };
  const SCRIPT_NAMES = {
    Latn:'Latin', Cyrl:'Cyrillic', Grek:'Greek', Armn:'Armenian', Hebr:'Hebrew', Arab:'Arabic',
    Deva:'Devanagari', Taml:'Tamil', Telu:'Telugu', Knda:'Kannada', Mlym:'Malayalam', Thai:'Thai',
    Mymr:'Myanmar', Geor:'Georgian', Hang:'Hangul', Khmr:'Khmer', Kana:'Kana', Hani:'Han',
    Hans:'Simplified Chinese', Hant:'Traditional Chinese'
  };

  // ------------------------------------------------------ function words
  const W = s => s.trim().split(/\s+/);
  const STOP = {
    Latn: {
      en: W(`the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into your good some could them see other than then now look only come its over think also back after use two how our well way even new want because any these give day most us is are was were has had am been did does don't i'm you're it's that's what's can't won't didn't there's let's okay oh yeah hey here where why right really gonna got said sorry please thank thanks 't 'm 're 'll 've 'd 's something nothing everything maybe never`),
      af: W(`die is nie ek jy het en van 'n te wat dit in op vir sy hy ons julle hulle my jou was sal kan moet gaan wil daar hier nou baie net maar ook ja nee asseblief dankie weet sê kom hom haar hoe waar hoekom wanneer al nog toe om met by na as so goed reg niks iets alles mense man vrou dat wees gewees word hierdie daardie gesê`),
      sq: W(`të në një është e i që nuk dhe me për ti unë ai ajo ne ju ata do jam je ka kam ke po jo çfarë si ku pse kush kur mirë shumë këtu atje tani edhe por nga pa më se ta ma ia duhet mund thuaj faleminderit lutem këtë atë janë ishte kishte vetëm gjithçka asgjë diçka mos kjo ky`),
      az: W(`və bu bir mən sən o biz siz onlar deyil yox bəli nə niyə harada necə kim var yoxdur edir etmək olmaq olar ki da də ilə üçün amma çox yaxşı indi burada orada mənim sənin onun bizim hə məni səni ona sənə mənə deyir gəl get bilirəm bilmirəm istəyirəm lazımdır olsun sağ ol təşəkkür edirəm oldu`),
      id: W(`yang dan di ini itu tidak aku kamu dia kami kita mereka apa ada akan dengan untuk ke dari saya anda sudah belum bisa juga tapi karena kalau ya tak mau harus sini sana bagaimana mengapa kenapa siapa kapan dimana sekarang lagi saja hanya sangat baik terima kasih tolong nggak gak enggak banget aja udah dong kok nih`),
      ms: W(`yang dan di ini itu tidak aku kamu dia kami kita mereka apa ada akan dengan untuk ke dari saya awak anda sudah belum boleh juga tapi tetapi kerana kalau ya tak mahu harus perlu sini sana bagaimana mengapa kenapa siapa bila mana sekarang lagi saja hanya sangat baik terima kasih tolong encik cik betul sahaja nak kau lah pun`),
      eu: W(`eta da ez bat du dut duzu naiz zara zer nor non nola zergatik noiz bai ere baina hau hori hura ni zu gu zuek haiek nire zure bere gure hemen han orain oso ondo gauza dago daude egin izan behar nahi dezaket esan badakit dakit eskerrik asko mesedez ba al zen zuen dira`),
      hr: W(`je i u da se na ne to su za a što sam si smo ste od sa s ali ako kako kad gdje zašto tko ja ti on ona mi vi oni ovo ono taj ova moj tvoj bio bila bilo biti ima nema može mogu hoću neću hvala molim dobro sada sad ovdje tamo samo još već li bi ću će vrlo točno tisuću tjedan kruh sretan zrak općenito trebam`),
      bs: W(`je i u da se na ne to su za a šta sam si smo ste od sa s ali ako kako kad gdje zašto ko ja ti on ona mi vi oni ovo ono taj ova moj tvoj bio bila bilo biti ima nema može mogu hoću neću hvala molim dobro sada sad ovdje tamo samo još već li bi ću će hiljadu sedmica hljeb kahva uopće`),
      sr: W(`je i u da se na ne to su za a šta sam si smo ste od sa s ali ako kako kad gde zašto ko ja ti on ona mi vi oni ovo ono taj ova moj tvoj bio bila bilo biti ima nema može mogu hoću neću hvala molim dobro sada sad ovde tamo samo još već li bi ću će veoma tačno hiljadu nedelja hleb srećan vazduh uopšte`),
      ca: W(`el la els les de que i a en és no un una per amb em et es ho ha he has hem han ser estar molt però perquè què qui com on quan sí ara aquí allà això aquest aquesta jo tu ell ella nosaltres vosaltres ells meu teu seu també res tot gràcies si bé doncs vull pots puc fer dir anar sóc ets som sou són era tinc tens té hi l' d' s' m' n' t' gens mai`),
      cs: W(`a je to se na že v s z do jsem jsi jsme jste jsou není nejsem byl byla bylo být mám máš má ano ne co jak kde proč kdo kdy tady tam teď už ještě jen taky také ale protože když já ty on ona my vy oni můj tvůj jeho její náš ten ta tu toho tomu mě mi tě ti ho mu děkuji děkuju prosím dobře moc chci můžu musím vím nevím řekl jo prostě něco nic všechno`),
      sk: W(`a je to sa na že v s z do som si sme ste sú nie bol bola bolo byť mám máš má áno čo ako kde prečo kto kedy tu tam teraz už ešte len tiež ale pretože keď ja ty on ona my vy oni môj tvoj jeho jej náš ten tá toho tomu ma mi ťa ti ho mu ďakujem prosím dobre veľmi chcem môžem musím viem neviem povedal hej proste niečo nič všetko`),
      da: W(`og i at det er en et den til på de med for ikke som har jeg du han hun vi dem mig dig ham hende min din sin var være kan skal vil os jer hvad hvor hvorfor hvem hvornår ja nej tak godt her der nu også men fordi hvis så bare lige noget ingenting alt meget måske kom gå sige ved okay sgu nok hvordan sig`),
      no: W(`og i å det er en et den til på de med for ikke som har jeg du han hun vi dem meg deg ham henne min din sin var være kan skal vil oss dere hva hvor hvorfor hvem når ja nei takk godt her der nå også men fordi hvis så bare noe ingenting alt veldig kanskje kom gå si vet hvordan jo seg`),
      sv: W(`och i att det är en ett den till på de med för inte som har jag du han hon vi ni dem mig dig honom henne min din sin var vara kan ska vill oss er vad varför vem när ja nej tack bra här där nu också men eftersom om så bara något ingenting allt mycket kanske kom gå säga vet hur okej jo nån inget får sig`),
      nl: W(`de het een en van ik je jij is dat niet in op te met voor zijn er maar hij zij ze we wij jullie wat waar waarom wie wanneer hoe ja nee dank bedankt alsjeblieft goed hier daar nu ook want als zo al nog heb hebt heeft ben bent was waren kan kunnen moet wil ga gaat weet mijn jouw haar ons hem me mij iets niets alles heel echt oké even toch wel geen naar`),
      de: W(`der die das und ist nicht ich du er sie es wir ihr ein eine einen zu in den mit von auf für ja nein was wo warum wer wann wie hier da jetzt auch aber weil wenn so schon noch nur bin bist sind war hat habe hast haben kann muss will mich dich mir dir sich mein dein sein kein keine nichts alles etwas sehr danke bitte gut okay doch mal gehen weiß denn dass dem`),
      et: W(`ja on ei see et ma sa ta me te nad mis kus miks kes millal kuidas jah ole oli olen oled oleme mul sul tal meil teil neil minu sinu tema siin seal nüüd ka aga sest kui nii juba veel ainult väga hästi aitäh palun tänan tahan saan pean tean tea midagi kõik mitte mind sind teda tule mine`),
      fi: W(`ja on ei se että en et hän me te he mitä missä miksi kuka milloin miten kyllä joo ole oli olen olet olemme minulla sinulla hänellä minun sinun hänen tämä tuo täällä siellä nyt myös mutta koska jos niin jo vielä vain hyvin kiitos hyvä haluan voin täytyy tiedän tiedä mitään kaikki minä sinä mua sua mä sä onko oletko tule mene`),
      fr: W(`le la les de des un une et est je tu il elle nous vous ils elles que qui quoi pas ne ce c' j' l' d' n' qu' s' m' en dans pour avec sur au aux du mais ou où pourquoi comment quand oui non merci bien ici là maintenant aussi parce si très tout rien quelque suis es sommes êtes sont était ai as a avons avez ont fait peux veux dois sais moi toi lui leur mon ton son ma ta sa mes tes ses ça va vais on c'est d'accord`),
      ga: W(`agus an na is tá ní níl mé tú sé sí muid sibh siad a ar ag le do de go i sa seo sin anseo ansin anois cad cá conas cén cathain cé bhí bhfuil tabhair raibh maith agat níos ceart dom duit dó di linn libh leo mo ár bhur arís freisin ach mar má uair éigin rud`),
      cy: W(`y yr a ac yn ydy ydw mae oedd roedd dw i ti fe fo hi ni chi nhw beth ble pam pwy pryd sut ie na nage diolch os gwelwch da yma yna nawr rŵan hefyd ond achos mor wedi bod gallu isio eisiau gwybod dim ddim fy dy ei ein eich eu gyda o am ar at gan hwn hon hyn rhywbeth popeth`),
      hu: W(`a az és hogy nem van egy is ez én te ő mi ti ők mit hol miért ki mikor hogyan igen vagyok vagy vagyunk vagytok vannak volt voltam nekem neked neki itt ott most már még csak nagyon jó köszönöm kérem kérlek akarok tudok kell tudom semmi minden valami de mert ha így sem meg el fel le be velem veled engem téged őt jól szia`),
      is: W(`og að er ekki ég þú hann hún við þið þeir það en sem á í um til með fyrir hvað hvar hvers vegna hver hvenær hvernig já nei takk gott hér þar núna líka af því ef svo bara eitthvað ekkert allt mjög kannski var vera get getur vil veit mig þig hana minn þinn sinn`),
      it: W(`il lo la i gli le di che e è non un una per con in su da ma se come dove perché chi quando cosa sì no grazie bene qui qua lì là ora adesso anche molto tutto niente qualcosa sono sei siamo siete era ho hai ha abbiamo avete hanno fatto posso voglio devo so io tu lui lei noi voi loro mio tuo suo mi ti ci vi ne l' c' dell' all' un' questo quello va vado andiamo allora già ancora solo`),
      lv: W(`un ir nav es tu viņš viņa mēs jūs viņi ka kas kur kāpēc kurš kad kā jā nē paldies labi šeit tur tagad arī bet jo ja tā jau vēl tikai ļoti biju bija esmu esi esam man tev viņam mans tavs ko to šo tas šis gribu varu vajag zinu nezinu nekas viss kaut ar uz no par`),
      lt: W(`ir yra nėra aš tu jis ji mes jūs jie kad kas kur kodėl kuris kada kaip taip ne ačiū gerai čia ten dabar pat bet nes jei jau dar tik labai buvo buvau esu esi esame man tau jam mano tavo jo ką tai šį tas šis noriu galiu reikia žinau nežinau nieko viskas kažkas su į iš apie prašau`),
      pl: W(`i w nie to się na z że jest do co jak ale tak jestem jesteś jesteśmy są był była było być mam masz ma mamy gdzie dlaczego kto kiedy tu tutaj tam teraz też także bo jeśli już jeszcze tylko bardzo dobrze dziękuję proszę chcę mogę muszę wiem nic wszystko coś ja ty on ona my wy oni mój twój jego jej mnie ci mu go ją ten ta tego czy no może`),
      pt: W(`o a os as de do da dos das e é que não um uma em no na para com por se mas eu tu ele ela nós vocês eles elas você onde porque quem quando como sim obrigado obrigada bem aqui ali agora também muito tudo nada algo sou és somos são era foi estou está estamos estão tenho tens tem temos têm fazer posso quero devo sei meu minha teu tua seu sua me te lhe isso isto aquilo vai vou já ainda só então`),
      es: W(`el la los las de del y o a es que no un una en por para con se me te le lo mi tu su pero si sí yo tú él ella nosotros ustedes ellos ellas usted qué dónde quién cuándo cómo gracias bien aquí allí ahora también muy todo nada algo soy eres somos son era fue estoy estás está estamos están tengo tienes tiene tenemos tienen hacer puedo quiero debo sé esto eso aquello va voy ya todavía solo entonces vamos hay al`),
      gl: W(`o a os as de do da dos das e é que non un unha en no na para con por se mais pero eu ti el ela nós vós eles elas onde porque quen cando como si grazas ben aquí alí agora tamén moito todo nada algo son es somos era foi estou está estamos están teño tes ten temos fago podo quero sei meu miña teu túa seu súa me che lle iso isto vai vou xa aínda só entón`),
      ro: W(`și în la de pe nu cu un o că este e sunt ești suntem sunteți eram era a fost am ai are avem aveți au eu tu el ea noi voi ei ele ce unde cine când cum da mulțumesc bine aici acolo acum dar pentru dacă așa deja încă doar foarte vreau pot trebuie știu nimic totul ceva meu tău lui mea ta mă te îl îi mi ți asta ăsta aia ăla hai`),
      sl: W(`je in v o da se na ne to so za a kaj sem si smo ste od s z ampak če kako kdaj kje zakaj kdo jaz ti on ona mi vi oni ta ono moj tvoj njegov bil bila bilo biti ima nima lahko hočem nočem hvala prosim dobro zdaj tukaj tam samo še že ali bi bom boš bo sva sta nisem nisi ni vem nič vse nekaj zelo`),
      tl: W(`ang ng mga sa na ay at ako ikaw ka siya kami tayo kayo sila ko mo niya namin natin ninyo nila ito iyan iyon ano saan bakit sino kailan paano oo hindi po opo salamat mabuti dito diyan doon ngayon rin din pero kasi kung lang naman talaga gusto kailangan alam wala may mayroon nga ba si kay yung naku`),
      tr: W(`bir ve bu da de ne ben sen o biz siz onlar değil yok evet hayır nerede neden niye kim zaman nasıl var için ile ama çok iyi şimdi burada orada benim senin onun bizim beni seni onu bana sana ona mi mı mu mü misin musun sağ ol teşekkürler teşekkür ederim lütfen tamam şey hiçbir her gibi daha çünkü eğer bak gel git biliyorum bilmiyorum istiyorum lazım olur`),
      vi: W(`và là của không có tôi bạn anh em chị cô ông bà nó chúng ta họ này đó gì đâu tại sao ai khi nào như thế vâng dạ cảm ơn được rồi ở đây đấy bây giờ cũng nhưng vì nếu đã chưa chỉ rất tốt muốn thể phải biết đi làm với cho một những các thì mà`)
    },
    Cyrl: {
      ru: W(`и в не на я что он с как это а то все она так его но да ты к у же вы за бы по только ее её мне было вот от меня еще ещё нет о из ему теперь когда даже ну ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без чего раз тоже себе под будет тогда кто этот того потому этого какой совсем здесь один мой чтобы сейчас были куда зачем всех никогда можно после больше тот через эти нас про всего них много хорошо лучше конечно спасибо пожалуйста`),
      uk: W(`і й в не на я що він з як це а то все вона так його але ти до у же ви за б по тільки її мені було ось від мене ще ні о йому тепер коли навіть ну чи якщо вже або бути був нього вас там потім себе нічого їй може вони тут де є треба ній для ми тебе їх чим була сам без чого раз теж собі під буде тоді хто цей того тому цього який зовсім дякую будь ласка добре мій моя`),
      bg: W(`и в не на аз че той с как това а то всичко тя така го но да ти към у же вие за би по само я ми беше ето от мен още няма о из му сега когато дори ли ако вече или него до вас там после себе си нищо може те тук къде е има трябва ние теб тях какво сам без защо също под ще тогава кой този онзи много благодаря моля добре съм сме сте са нещо кажи`),
      mk: W(`и во не на јас дека тој со како ова а тоа сè таа така го но да ти кон кај вие за би по само ја ми беше еве од мене уште нема сега кога дури ли ако веќе или него до вас таму потоа себе ништо може тие тука каде е има треба ние тебе нив што сам без зошто исто под ќе тогаш кој овој многу благодарам ве молам добро сум си сме сте се нешто`),
      sr: W(`и у не на ја да је се то су за а што сам си смо сте од са с али ако како кад где зашто ко он она ми ви они ово оно тај моја мој твој био била било бити има нема може могу хоћу нећу хвала молим добро сада ту тамо само још већ ли би ћу ће шта`),
      mn: W(`би чи тэр бид та тэд энэ юу хаана яагаад хэн хэзээ яаж тийм үгүй баярлалаа сайн энд тэнд одоо ч гэхдээ учир хэрэв бол байна байсан байх юм гэж гэсэн биш надад чамд миний чиний`)
    },
    Arab: {
      ar: W(`في من على أن إلى هذا هذه لا ما هل لم لن كان كانت هو هي أنا أنت نحن هم ذلك التي الذي مع عن كل قد لقد إن يا ماذا لماذا أين كيف متى نعم شكرا حسنا الآن هنا هناك أيضا لكن لأن إذا فقط جدا شيء أريد يمكن يجب أعرف`),
      fa: W(`و در به از که این را با است آن برای می یک هم تا من تو او ما شما آنها چه کجا چرا کی چطور بله نه ممنون مرسی خوب اینجا آنجا الان اما چون اگر فقط خیلی چیزی خواهم توانم باید دانم نمی هست نیست بود شد کن رو`),
      ur: W(`ہے ہیں میں کے کی کا نہیں کہ اور یہ وہ آپ ہم تم مجھے تھا تھی تھے کیا کیوں کہاں کون کب کیسے ہاں جی شکریہ ٹھیک یہاں وہاں اب بھی لیکن کیونکہ اگر صرف بہت کچھ چاہتا سکتا ہوں گا گی`),
      ps: W(`دی ده په چې او له ته زه هغه موږ تاسو دوی دا څه چیرته ولې څوک کله څنګه هو نه مننه ښه دلته هلته اوس هم خو ځکه که یوازې ډېر غواړم کولی شم باید پوهیږم یم یې`)
    }
  };

  // Distinctive letters: char -> languages that use it.
  const CHARS = {
    Latn: {
      'ñ':'es', 'ã':'pt', 'õ':'pt et', 'ç':'fr pt ca tr az sq', 'ø':'da no', 'æ':'da no is', 'å':'da no sv',
      'ä':'de sv fi et sk', 'ö':'de sv fi et hu tr az is', 'ü':'de hu tr az et', 'ß':'de', 'ő':'hu', 'ű':'hu',
      'ł':'pl', 'ż':'pl', 'ś':'pl', 'ź':'pl', 'ń':'pl', 'ą':'pl lt', 'ę':'pl lt', 'ć':'pl hr bs sr',
      'ř':'cs', 'ů':'cs', 'ě':'cs', 'ň':'cs sk', 'ť':'cs sk', 'ď':'cs sk', 'ľ':'sk', 'ĺ':'sk', 'ŕ':'sk', 'ô':'sk fr pt vi',
      'š':'cs sk sl hr bs sr lv lt', 'ž':'cs sk sl hr bs sr lv lt', 'č':'cs sk sl hr bs sr lv lt', 'đ':'hr bs sr vi',
      'ş':'tr az', 'ğ':'tr az', 'ı':'tr az', 'ə':'az', 'ș':'ro', 'ț':'ro', 'ă':'ro vi', 'â':'ro fr tr pt vi', 'î':'ro fr',
      'ë':'sq nl af fr', 'ê':'pt fr af vi', 'û':'fr tr', 'ï':'fr nl af ca', 'œ':'fr',
      'ā':'lv', 'ē':'lv', 'ī':'lv', 'ū':'lv lt', 'ģ':'lv', 'ķ':'lv', 'ļ':'lv', 'ņ':'lv', 'ė':'lt', 'į':'lt', 'ų':'lt',
      'þ':'is', 'ð':'is', 'ŵ':'cy', 'ŷ':'cy', 'ơ':'vi', 'ư':'vi',
      'à':'fr it ca pt vi', 'è':'fr it ca', 'ì':'it vi', 'ò':'it ca vi', 'ù':'it fr vi'
    },
    Cyrl: {
      'ы':'ru', 'э':'ru mn', 'ё':'ru mn', 'ъ':'bg ru', 'і':'uk', 'ї':'uk', 'є':'uk', 'ґ':'uk',
      'ѓ':'mk', 'ќ':'mk', 'ѕ':'mk', 'ђ':'sr', 'ћ':'sr', 'љ':'sr mk', 'њ':'sr mk', 'џ':'sr mk', 'ј':'sr mk',
      'ө':'mn', 'ү':'mn'
    },
    Arab: {
      'ة':'ar', 'ى':'ar', 'أ':'ar', 'إ':'ar', 'ي':'ar', 'ك':'ar',
      'پ':'fa ur ps', 'چ':'fa ur ps', 'ژ':'fa ur ps', 'گ':'fa ur', 'ی':'fa ur ps', 'ک':'fa ur ps',
      'ٹ':'ur', 'ڈ':'ur', 'ڑ':'ur', 'ں':'ur', 'ے':'ur', 'ھ':'ur', 'ہ':'ur',
      'ټ':'ps', 'ډ':'ps', 'ړ':'ps', 'ږ':'ps', 'ښ':'ps', 'ځ':'ps', 'څ':'ps', 'ګ':'ps', 'ڼ':'ps', 'ې':'ps', 'ۍ':'ps'
    }
  };
  const VI_TONE = /[Ạ-ỹ]/g;

  // Build lookup tables with inverse-document-frequency weights.
  const WORD_INDEX = {};   // script -> Map(word -> [[lang, weight], ...])
  const LANGS_BY_SCRIPT = {};
  for (const script of Object.keys(STOP)) {
    const df = new Map();
    const langs = Object.keys(STOP[script]);
    LANGS_BY_SCRIPT[script] = langs;
    for (const lang of langs) for (const w of new Set(STOP[script][lang])) df.set(w, (df.get(w) || 0) + 1);
    const idx = new Map();
    for (const lang of langs) for (const w of new Set(STOP[script][lang])) {
      if (!idx.has(w)) idx.set(w, []);
      idx.get(w).push([lang, 1 / df.get(w)]);
    }
    WORD_INDEX[script] = idx;
  }
  const CHAR_INDEX = {};
  for (const script of Object.keys(CHARS)) {
    const m = new Map();
    for (const [ch, langs] of Object.entries(CHARS[script])) {
      const ls = langs.split(' ');
      m.set(ch, ls.map(l => [l, 1 / ls.length]));
    }
    CHAR_INDEX[script] = m;
  }

  // ------------------------------------------------ Chinese variant tables
  // Pairs: simplified char followed by its traditional form.
  const ZH_PAIRS = '这這个個们們来來时時说說对對会會为為过過还還没沒么麼发發样樣经經现現开開关關见見听聽点點头頭话話问問间間长長东東车車门門马馬鸟鳥鱼魚书書学學国國爱愛边邊让讓谁誰谢謝请請认認识識应應该該实實进進动動电電觉覺给給从從儿兒吗嗎难難离離钱錢买買卖賣办辦记記语語讲講谈談与與业業两兩乐樂习習亲親气氣汉漢爷爺妈媽孙孫宝寶岁歲帮幫广廣张張当當录錄总總战戰报報护護担擔据據换換无無旧舊显顯杀殺机機杂雜条條极極标標欢歡满滿热熱灵靈灯燈烦煩独獨猪豬环環疯瘋监監盘盤确確礼禮种種称稱稳穩笔筆简簡类類红紅纸紙线線练練组組细細终終结結绝絕统統继繼续續维維网網罗羅脑腦脸臉艺藝节節苏蘇药藥虽雖补補装裝视視计計讨討许許论論设設访訪证證评評诉訴试試诗詩详詳误誤读讀谎謊贝貝负負责責败敗货貨质質贵貴费費资資赢贏赶趕轻輕较較辆輛输輸达達运運远遠连連迟遲适適选選递遞邮郵钟鐘钥鑰铁鐵银銀错錯锁鎖闭閉闹鬧闻聞队隊阳陽阴陰际際陆陸险險随隨隐隱雾霧响響页頁顶頂须須顾顧预預领領题題颜顏风風飞飛饭飯饿餓馆館验驗骗騙鸡雞麦麥齐齊龙龍义義乡鄉乱亂争爭亚亞产產亿億仅僅众眾优優传傳伤傷体體余餘侣侶债債倾傾党黨兰蘭兴興养養冲衝决決况況冻凍净淨准準凉涼减減几幾凭憑击擊刘劉则則刚剛创創别別剧劇劝勸务務励勵劳勞势勢区區医醫华華协協单單卫衛却卻厅廳历歷压壓厌厭县縣参參双雙变變叶葉号號叹嘆吓嚇启啟员員团團园園围圍图圖圆圓圣聖场場坏壞块塊坚堅声聲处處备備复復夺奪奖獎妇婦宁寧审審寻尋导導将將尔爾尘塵层層属屬岛島币幣师師带帶并並庆慶库庫废廢异異弃棄弹彈归歸彻徹忆憶态態怀懷怜憐恋戀恶惡恼惱惊驚惧懼惨慘惯慣愿願忧憂戏戲执執扩擴扫掃扬揚扰擾抢搶拥擁择擇挂掛挡擋挤擠挥揮损損摆擺摇搖敌敵数數断斷暂暫术術权權杨楊构構枪槍桥橋梦夢检檢楼樓残殘毁毀毕畢汤湯沟溝泪淚洁潔浅淺测測济濟浓濃渐漸湾灣滚滾灭滅灾災炉爐烟煙烧燒牵牽状狀犹猶狱獄猎獵献獻画畫疗療盖蓋盗盜盐鹽码碼础礎碍礙祸禍积積窃竊竞競签簽粮糧紧緊纪紀约約级級纯純纳納纷紛织織绑綁绕繞绘繪络絡编編缘緣罚罰职職联聯聪聰肤膚胆膽胜勝脏髒脚腳获獲营營虑慮虫蟲观觀规規览覽触觸订訂训訓议議词詞译譯诚誠询詢课課调調谅諒谜謎财財贫貧购購贴貼贷貸贺賀赌賭赏賞赔賠赚賺赛賽赞讚趋趨跃躍践踐转轉轮輪软軟载載辈輩辞辭迁遷违違迹跡遗遺邻鄰释釋针針钢鋼铃鈴链鏈销銷锅鍋键鍵镇鎮镜鏡闪閃闯闖闲閒闷悶阅閱阵陣阶階陈陳韩韓顺順顿頓频頻颗顆额額饮飲饱飽驾駕骂罵骑騎鲜鮮鸭鴨齿齒龟龜';
  const SIMP = new Set(), TRAD = new Set();
  { const arr = Array.from(ZH_PAIRS); for (let i = 0; i + 1 < arr.length; i += 2) { if (arr[i] !== arr[i+1]) { SIMP.add(arr[i]); TRAD.add(arr[i+1]); } } }
  const CANTONESE = new Set(Array.from('係嘅唔咗佢喺冇啲嘢咁睇乜嚟噉咩㗎嗰啱攞諗揾搵'));

  // ------------------------------------------------ tokenization
  function tokenize(text) {
    const raw = text.toLowerCase().replace(/[‘’ʼ`´]/g, "'").match(/[\p{L}\p{M}']+/gu) || [];
    const out = [];
    for (let t of raw) {
      t = t.replace(/'+$/, '');
      if (!t || t === "'") continue;
      out.push(t);
      const i = t.indexOf("'");
      if (i >= 0) {
        if (i > 0) out.push(t.slice(0, i + 1));
        if (i < t.length - 1) out.push(t.slice(i));
      }
    }
    return out;
  }

  // ------------------------------------------------ core analysis
  // Returns {script, scriptCounts, letters, scores:{lang:score}, tokens, hits, han info}
  function analyze(text) {
    const sc = {};
    let letters = 0;
    for (const ch of text) {
      const s = charScript(ch.codePointAt(0));
      if (s) { sc[s] = (sc[s] || 0) + 1; letters++; }
    }
    const res = { scriptCounts: sc, letters, scores: {}, hits: 0, tokens: 0 };
    if (!letters) return res;
    // Kana + Han are "CJK"; decide Japanese vs Chinese together.
    const kana = sc.Kana || 0, hani = sc.Hani || 0;
    let script = Object.keys(sc).reduce((a, b) => sc[a] >= sc[b] ? a : b);
    if ((kana + hani) >= (sc[script] || 0) && (kana + hani) > 0) script = (kana > 0 && kana >= 0.08 * (kana + hani)) ? 'Kana' : 'Hani';
    res.script = script;

    if (script === 'Kana') { res.scores.ja = kana + hani; res.hits = kana; return res; }
    if (script === 'Hani') {
      let s = 0, t = 0, c = 0;
      for (const ch of text) { if (SIMP.has(ch)) s++; else if (TRAD.has(ch)) t++; if (CANTONESE.has(ch)) c++; }
      res.han = { simp: s, trad: t, cantonese: c, total: hani };
      res.scores.zh = hani;
      res.hits = hani;
      return res;
    }
    if (SINGLE_SCRIPT_LANG[script]) { res.scores[SINGLE_SCRIPT_LANG[script]] = sc[script]; res.hits = sc[script]; return res; }

    const idx = WORD_INDEX[script], cidx = CHAR_INDEX[script];
    if (!idx) return res;
    const scores = {};
    for (const l of LANGS_BY_SCRIPT[script]) scores[l] = 0;
    const toks = tokenize(text);
    res.tokens = toks.length;
    for (const t of toks) {
      const e = idx.get(t);
      if (e) { res.hits++; for (const [l, w] of e) scores[l] += w; }
    }
    if (cidx) {
      const lower = text.toLowerCase();
      for (const ch of lower) {
        const e = cidx.get(ch);
        if (e) for (const [l, w] of e) scores[l] = (scores[l] || 0) + 0.35 * w;
      }
      if (script === 'Latn') {
        const vt = (lower.match(VI_TONE) || []).length;
        if (vt) scores.vi += 0.5 * vt;
      }
    }
    res.scores = scores;
    return res;
  }

  function ranked(scores) {
    return Object.entries(scores).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);
  }

  // Merge several analyses (e.g. all cues of a file).
  function merge(list) {
    const out = { scriptCounts: {}, letters: 0, scores: {}, hits: 0, tokens: 0, han: { simp: 0, trad: 0, cantonese: 0, total: 0 } };
    for (const a of list) {
      out.letters += a.letters; out.hits += a.hits; out.tokens += a.tokens;
      for (const [k, v] of Object.entries(a.scriptCounts)) out.scriptCounts[k] = (out.scriptCounts[k] || 0) + v;
      if (a.script === 'Hani' || a.script === 'Kana' || !a.script) {}
      for (const [k, v] of Object.entries(a.scores)) {
        // Weight scores by script so a few English credits don't outvote a Cyrillic file.
        out.scores[k] = (out.scores[k] || 0) + v;
      }
      if (a.han) for (const k of Object.keys(out.han)) out.han[k] += a.han[k];
    }
    return out;
  }

  // Decide a language for a single cue (strict: used for "other language" detection).
  function classifyCue(a, primary) {
    if (!a.script || a.letters < 2) return null;
    // Kanji-only lines are normal in Japanese; Han-only lines in Cantonese files are normal.
    if (a.script === 'Hani' && (primary === 'ja' || primary === 'yue' || primary === 'zh')) return { lang: primary, strong: false };
    if (a.script === 'Hani' || a.script === 'Kana' || SINGLE_SCRIPT_LANG[a.script]) {
      const lang = a.script === 'Hani' ? 'zh' : a.script === 'Kana' ? 'ja' : SINGLE_SCRIPT_LANG[a.script];
      // Require a meaningful amount of text in a non-Latin script.
      const min = (a.script === 'Hani' || a.script === 'Kana') ? 2 : 4;
      return a.letters >= min ? { lang, strong: true } : null;
    }
    const r = ranked(a.scores);
    if (!r.length) return null;
    const [best, bs] = r[0];
    const second = r[1] ? r[1][1] : 0;
    // Strong: enough function-word evidence and a clear margin.
    const strong = a.hits >= 3 && a.tokens >= 4 && bs >= 1.8 && bs >= 3 * second;
    // If primary scores nearly as well, keep the cue with the primary language.
    if (primary && a.scores[primary] !== undefined && a.scores[primary] >= 0.6 * bs) return { lang: primary, strong: false };
    return { lang: best, strong };
  }

  // Script-level decision for whole-file primary language.
  function primaryFrom(merged) {
    const sc = merged.scriptCounts;
    if (!merged.letters) return null;
    const kana = sc.Kana || 0, hani = sc.Hani || 0;
    // Pick the dominant script first.
    const entries = Object.entries(sc).filter(([k]) => k !== 'Kana' && k !== 'Hani');
    if (kana + hani) entries.push(['CJK', kana + hani]);
    entries.sort((a, b) => b[1] - a[1]);
    const dom = entries[0][0];
    let lang, script = dom, conf = 'high', alt = null;
    if (dom === 'CJK') {
      if (kana >= 0.08 * (kana + hani)) { lang = 'ja'; script = 'Jpan'; }
      else {
        lang = 'zh';
        const h = merged.han;
        script = h.simp > h.trad * 1.5 ? 'Hans' : h.trad > h.simp * 1.5 ? 'Hant' : (h.simp + h.trad < 3 ? 'Hani' : 'Hans/Hant?');
        if (h.total && h.cantonese / h.total > 0.015) lang = 'yue';
      }
    } else if (SINGLE_SCRIPT_LANG[dom]) {
      lang = SINGLE_SCRIPT_LANG[dom];
    } else {
      const langs = LANGS_BY_SCRIPT[dom] || [];
      const r = langs.map(l => [l, merged.scores[l] || 0]).sort((a, b) => b[1] - a[1]);
      if (!r.length || r[0][1] === 0) return { lang: null, script: dom, conf: 'none' };
      lang = r[0][0];
      const ratio = r[1] && r[1][1] > 0 ? r[0][1] / r[1][1] : Infinity;
      alt = r[1] ? r[1][0] : null;
      conf = r[0][1] < 4 ? 'low' : ratio < 1.25 ? 'low' : ratio < 1.6 ? 'medium' : 'high';
      if (conf !== 'high' && alt && sameCluster(lang, alt)) conf = 'cluster';
    }
    if (lang === 'sr' || (dom === 'Cyrl' && lang === 'sr')) script = dom;
    return { lang, script, conf, alt };
  }

  // --------------------------------------------- regional markers
  // Unicode-aware whole-word matcher (JS \b is ASCII-only).
  const words = (list, extra) => new RegExp(`(?<![\\p{L}])(?:${list.split('|').join('|')})(?![\\p{L}])${extra ? '|' + extra : ''}`, 'giu');
  const REGION_MARKERS = {
    es: {
      'es-ES': words('vosotros|vosotras|vuestro|vuestra|vuestros|vuestras|os|habéis|tenéis|sois|estáis|queréis|podéis|sabéis|vais|hacéis|decís|venís|coger|tío|tía|ordenador|móvil|gilipollas|coño|hostia|guay|mola'),
      'es-419': words('ustedes|celular|computadora|carro|platicar|chamaco|órale|ahorita|chévere|pibe|boludo|güey|wey|manejar|lindo')
    },
    pt: {
      'pt-PT': words('estou a|estás a|está a|estamos a|estão a|autocarro|comboio|rapariga|telemóvel|casa de banho|fixe|bué|pequeno-almoço|equipa|facto|contigo'),
      'pt-BR': words('você|vocês|ônibus|trem|celular|banheiro|a gente|beleza|café da manhã|tá|pra|pro', '(?<![\\p{L}])\\p{L}+(?:ando|endo|indo)(?![\\p{L}])')
    },
    fr: {
      'fr-CA': words('char|chum|tsé|icitte|pantoute|tabarnak|câlisse|calvaire|courriel|magasiner|stationnement|dépanneur|niaiser|placoter|fin de semaine|présentement|pis'),
      'fr-FR': words('week-end|parking|mail|mec|nana|bagnole|kiffer|putain|ouais')
    }
  };
  function regionMarkers(base, text) {
    const m = REGION_MARKERS[base];
    if (!m) return null;
    const out = {};
    for (const [reg, re] of Object.entries(m)) {
      const found = text.match(re) || [];
      const counts = {};
      for (const f of found) { const k = f.toLowerCase(); counts[k] = (counts[k] || 0) + 1; }
      out[reg] = { total: found.length, counts };
    }
    return out;
  }

  return { analyze, merge, classifyCue, primaryFrom, regionMarkers, sameCluster, LANG_NAMES, SCRIPT_NAMES, charScript, CLUSTERS };
})();
if (typeof module !== 'undefined') module.exports = Detector;
