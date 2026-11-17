# Realty Photo AI для iOS — как выложить в App Store

Проект: `ios/RealtyPhotoAI.xcodeproj` · SwiftUI · iOS 17+ · только iPhone, портрет · языки EN / ES / RU
Bundle ID: `com.realtyphotoai.app` · Сервер: `https://web-production-88f12.up.railway.app`

> Сборка для App Store — только **Xcode 26+ на Mac** (с 28 апреля 2026 Apple принимает сборки только с iOS 26 SDK).

---

## 0. Что уже готово в проекте

| Требование Apple | Где |
|---|---|
| Нативное приложение (не «обёртка сайта», правило 4.2) | SwiftUI: обработка, история, аккаунт, магазин |
| Покупки только через Apple (правило 3.1.1) | StoreKit 2, 3 расходуемых пакета; сервер проверяет подпись Apple и начисляет кредиты |
| Кредиты не сгорают (3.1.1) | так и есть, указано в магазине |
| Удаление аккаунта в приложении (5.1.1(v)) | Аккаунт → «Удалить аккаунт» |
| Ссылки на условия и конфиденциальность | вход, магазин, аккаунт |
| Privacy Manifest | `Resources/PrivacyInfo.xcprivacy` |
| Тексты разрешений (камера, сохранение в Фото) на 3 языках | `Resources/*.lproj/InfoPlist.strings` |
| Шифрование только HTTPS | `ITSAppUsesNonExemptEncryption = NO` — вопрос про экспорт не задаётся |
| Иконка 1024×1024 без прозрачности | `Resources/Assets.xcassets/AppIcon.appiconset` |
| Возвраты Apple синхронизируются | `/api/iap/notifications` (App Store Server Notifications V2) |

В приложении **нет** ссылок на оплату на сайте и цен сайта — это запрещено (правило 3.1.1). Баланс общий: купленное на сайте видно в приложении и наоборот.

---

## 1. Подготовка аккаунта (один раз)

1. **Apple Developer Program** — https://developer.apple.com/programs/ (99 $/год). Для компании нужен D-U-N-S.
2. App Store Connect → **Business** → подпишите **Paid Apps Agreement**, заполните банк и налоги. Без этого покупки не работают даже в тесте.
3. **App Store Small Business Program** — подайте заявку: комиссия Apple 15 % вместо 30 %.
4. **Статус трейдера (DSA, ЕС)** — App Store Connect → Business → Digital Services Act: укажите, что вы трейдер, и адрес/телефон/email. Без этого приложение не будет доступно в странах ЕС, включая Испанию.

## 2. Открыть проект в Xcode

1. Откройте `ios/RealtyPhotoAI.xcodeproj`.
2. Таргет **RealtyPhotoAI** → **Signing & Capabilities**:
   - **Team** — выберите свою команду;
   - **Bundle Identifier** — оставьте `com.realtyphotoai.app` или поменяйте на свой (например `es.vashdomen.fotos`). **Если меняете — добавьте на Railway переменную `APPLE_BUNDLE_ID` с тем же значением**, иначе сервер отклонит покупки.
   - **+ Capability → In-App Purchase**.
3. Запустите на симуляторе (⌘R) — вход, обработка, история должны работать с вашим сервером.

> Адрес сервера — в `RealtyPhotoAI/App/AppConfig.swift` (`baseURL`). Если подключите свой домен — поменяйте там.

## 3. Создать приложение в App Store Connect

**Apps → + → New App**: платформа iOS, имя `Realty Photo AI` (если занято — `Realty Photo AI: Staging`), основной язык — **Spanish (Spain)** или English, Bundle ID — как в Xcode, SKU — `realtyphotoai-ios`.

После создания запишите **Apple ID приложения** (цифры в App Information) — пригодится.

## 4. Встроенные покупки (In-App Purchases)

**Monetization → In-App Purchases → +**, тип **Consumable**, три штуки:

| Product ID | Reference Name | Цена (рекомендую) | Кредитов |
|---|---|---|---|
| `com.realtyphotoai.app.pack.start` | Pack 20 | 12,99 € | 20 |
| `com.realtyphotoai.app.pack.pro` | Pack 60 | 29,99 € | 60 |
| `com.realtyphotoai.app.pack.agency` | Pack 200 | 79,99 € | 200 |

Product ID = `<Bundle ID>.pack.<start|pro|agency>` — если меняли Bundle ID, меняйте и тут.
Количество кредитов задаёт сервер (те же пакеты, что на сайте), цену — Apple.

Локализации каждой покупки (Display Name / Description):

| | EN | ES | RU |
|---|---|---|---|
| start | 20 photos · 20 AI photo edits | 20 fotos · 20 ediciones con IA | 20 фото · 20 обработок ИИ |
| pro | 60 photos · 60 AI photo edits | 60 fotos · 60 ediciones con IA | 60 фото · 60 обработок ИИ |
| agency | 200 photos · 200 AI photo edits | 200 fotos · 200 ediciones con IA | 200 фото · 200 обработок ИИ |

Для каждой покупки нужен **скриншот для ревью** — снимок экрана «Пакеты фото» в приложении.

**App Store Server Notifications** (App Information → App Store Server Notifications), версия **2**, и Production, и Sandbox:
```
https://web-production-88f12.up.railway.app/api/iap/notifications
```

## 5. Страница в App Store

**App Information**
- Категория: **Photo & Video**, дополнительная — **Business**
- Content Rights: не содержит контента третьих лиц
- Age Rating: на все вопросы «No / None» → 4+

**URL**
- Privacy Policy: `https://web-production-88f12.up.railway.app/privacidad`
- Support URL: `https://web-production-88f12.up.railway.app/`
- Marketing URL (необязательно): `https://web-production-88f12.up.railway.app/`

### Тексты

**Spanish (Spain)**
- Subtitle (30): `Fotos IA para inmobiliarias`
- Promotional Text (170): `Amuebla pisos vacíos, cambia el cielo y crea fotos al atardecer en 30 segundos. 5 fotos gratis al registrarte.`
- Keywords (100): `home staging,inmobiliaria,fotos pisos,amueblar,idealista,fotocasa,hdr,agente,ia,decorar,cielo`
- Description:
```
Fotos que venden pisos, en 30 segundos.

Realty Photo AI convierte las fotos del móvil en imágenes de fotógrafo profesional para tus anuncios inmobiliarios.

HERRAMIENTAS
• Mejora automática: luz, HDR sin ventanas quemadas, balance de blancos y verticales rectas
• Home staging virtual: amuebla una estancia vacía en 7 estilos (nórdico, moderno, lujo…)
• Despejar: quita objetos personales, cables y desorden
• Estancia vacía: elimina los muebles
• Cambio de cielo y foto al atardecer con ventanas iluminadas
• Jardín: césped verde y patio limpio
• Renovar: paredes recién pintadas y superficies limpias
• Escalado ×2 para impresión
• Tarea propia: describe el cambio con tus palabras

PENSADO PARA AGENTES
• Procesa todo el piso de una vez
• Compara antes / después con un deslizador
• Guarda en Fotos o comparte al instante
• Marca «Amueblado virtual» automática, como exigen los portales
• Historial de todas tus fotos

PRECIO JUSTO
• 5 fotos gratis al registrarte
• Packs de fotos sin suscripción: los créditos no caducan

La IA mantiene paredes, ventanas y encuadre: solo cambia lo que pides. Tus fotos son tuyas y no se usan para entrenar modelos.

Condiciones: https://web-production-88f12.up.railway.app/condiciones
Privacidad: https://web-production-88f12.up.railway.app/privacidad
```

**English (U.S. / U.K.)**
- Subtitle: `AI photos for real estate`
- Promotional Text: `Stage empty rooms, replace grey skies and create twilight shots in 30 seconds. 5 free photos when you sign up.`
- Keywords: `virtual staging,real estate,listing photos,realtor,hdr,interior,furniture,ai,property,sky`
- Description:
```
Listing photos that sell — in 30 seconds.

Realty Photo AI turns phone photos into professional-grade real estate images.

TOOLS
• Auto enhance: light, HDR without blown-out windows, white balance, straight verticals
• Virtual staging: furnish empty rooms in 7 styles (Scandinavian, modern, luxury…)
• Declutter: remove personal items, cables and mess
• Empty room: remove all furniture
• Sky replacement and twilight shots with glowing windows
• Landscaping: green lawn, tidy yard
• Refresh: freshly painted walls, clean surfaces
• 2× upscaling for print
• Custom task: describe the change in your own words

BUILT FOR AGENTS
• Process the whole property at once
• Before / after slider
• Save to Photos or share instantly
• Automatic “Virtually staged” label, as listing portals require
• History of all your photos

FAIR PRICING
• 5 free photos when you sign up
• Photo packs, no subscription — credits never expire

The AI keeps walls, windows and framing — only what you ask for changes. Your photos are yours and are never used for model training.

Terms: https://web-production-88f12.up.railway.app/condiciones
Privacy: https://web-production-88f12.up.railway.app/privacidad
```

**Russian**
- Subtitle: `ИИ-фото для недвижимости`
- Promotional Text: `Меблировка пустых комнат, замена неба и вечерние фото за 30 секунд. 5 фото бесплатно после регистрации.`
- Keywords: `риелтор,недвижимость,стейджинг,фото квартиры,меблировка,hdr,интерьер,ии,объявление,агент`
- Description:
```
Фото, которые продают квартиры, — за 30 секунд.

Realty Photo AI превращает снимки с телефона в фото уровня профессионального фотографа для объявлений о недвижимости.

ИНСТРУМЕНТЫ
• Авто-улучшение: свет, HDR без пересвеченных окон, баланс белого, ровные вертикали
• Виртуальная меблировка пустой комнаты в 7 стилях (скандинавский, современный, премиум…)
• Убрать хлам: личные вещи, провода, беспорядок
• Пустая комната: убрать всю мебель
• Замена неба и вечерняя съёмка с огнями в окнах
• Благоустройство: зелёный газон, чистый двор
• Освежить ремонт: свежая покраска, чистые поверхности
• Апскейл ×2 для печати
• Своя задача: опишите изменение своими словами

ДЛЯ АГЕНТОВ
• Обработка всего объекта сразу
• Сравнение «до/после» ползунком
• Сохранение в «Фото» и отправка в один тап
• Автоматическая пометка «Виртуальный стейджинг», как требуют порталы
• История всех обработок

ЧЕСТНАЯ ЦЕНА
• 5 фото бесплатно после регистрации
• Пакеты фото без подписки — кредиты не сгорают

ИИ сохраняет стены, окна и ракурс — меняется только то, что вы попросили. Ваши фото принадлежат вам и не используются для обучения моделей.

Условия: https://web-production-88f12.up.railway.app/condiciones
Конфиденциальность: https://web-production-88f12.up.railway.app/privacidad
```

### Скриншоты
Нужны для iPhone **6.9"** (1320 × 2868). Симулятор **iPhone 17 Pro Max** → ⌘S сохраняет снимок.
Рекомендуемые 5 экранов: (1) до/после меблировки, (2) сетка инструментов, (3) результат вечерней съёмки, (4) история, (5) пакеты фото.
Сначала опубликуйте реальные демо в админке сайта — их же удобно показать на скриншотах.

## 6. App Privacy (анкета в App Store Connect)

**Data Collection → Yes**. Для каждого типа: *Linked to user — Yes*, *Used for tracking — No*, назначение — **App Functionality**:
- Contact Info → **Email Address**
- User Content → **Photos or Videos**
- Purchases → **Purchase History**
- Identifiers → **User ID**

Отслеживания (ATT) и рекламы нет.

## 7. Данные для ревьюера (App Review Information)

1. На сайте зарегистрируйте аккаунт, например `appreview@<ваш-домен>` (или gmail), пароль 8+ символов.
2. Админка → Пользователи → начислите ему **30 кредитов**.
3. В App Store Connect → Sign-In Information укажите email и пароль.

**Notes** (можно вставить как есть):
```
Realty Photo AI edits real estate listing photos with AI (virtual staging, HDR, sky replacement, twilight).

How to test:
1. Log in with the demo account provided (it has 30 credits).
2. Edit tab → Gallery → pick any room photo → choose "Virtual staging" → Process. The result appears in ~30–60 s with a before/after slider.
3. Credits can be purchased in the app via In-App Purchase (consumable packs: Account → Buy credits, or the balance button at the top).
4. Account deletion: Account → Delete account.

Photos are processed on our server (Railway, EU) using the fal.ai API. No tracking, no ads.
Purchases are verified server-side with Apple's signed transactions (StoreKit 2).
```

## 8. Тест покупок перед отправкой (Sandbox)

1. App Store Connect → Users and Access → **Sandbox** → создайте тестового пользователя.
2. На iPhone: Настройки → App Store → Sandbox Account → войдите им.
3. Установите сборку из Xcode или TestFlight, купите пакет — кредиты начислятся, в админке сайта покупка видна с меткой «App Store · sandbox».

> Покупки через локальный StoreKit-файл Xcode сервер не примет (они подписаны не Apple) — тестируйте через Sandbox или TestFlight.

## 9. Загрузка и отправка

1. Xcode → схема **RealtyPhotoAI**, устройство **Any iOS Device (arm64)**.
2. **Product → Archive** → Organizer → **Distribute App → App Store Connect → Upload**.
3. Через 10–30 минут сборка появится в App Store Connect → TestFlight. Ответьте на вопрос о шифровании, если спросят: *None of the algorithms mentioned above* (уже указано в проекте).
4. Версия 1.0 → выберите сборку → прикрепите **все 3 покупки** (раздел In-App Purchases на странице версии — при первой отправке их проверяют вместе с приложением) → **Add for Review** → **Submit**.

Следующие версии: увеличьте **Version** (1.0.1…) или **Build** (2, 3…) в таргете и повторите Archive.

## 10. Что делать при отказе

| Причина | Что ответить / исправить |
|---|---|
| 3.1.1 / 3.1.3(b) | Все цифровые покупки в приложении — через IAP; ссылок на внешнюю оплату нет. Кредиты с сайта доступны по 3.1.3(b), потому что те же пакеты продаются в приложении. |
| 4.2 Minimum functionality | Приложение нативное: обработка фото, камера, история, сравнение до/после, сохранение в Фото. |
| 5.1.1(v) | Удаление аккаунта: Account → Delete account. |
| 2.1 демо-аккаунт | Проверьте, что у демо-аккаунта есть кредиты и сервер отвечает. |
| 5.1.1 (обязательная регистрация) | Регистрация нужна, потому что обработка списывает кредиты с баланса аккаунта, общего для сайта и приложения. |
