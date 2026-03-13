require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { OAuth2Client } = require('google-auth-library');
const nodemailer = require('nodemailer');
const webpush = require('web-push');
const cron = require('node-cron');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const app = express();
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('🔮 Connected to the MongoDB Magic Vault!'))
    .catch(err => console.error('❌ Failed to connect to MongoDB:', err));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(express.static('public'));

// ==========================================
// ✉️ EMAIL TRANSPORTER SETUP
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ==========================================
// 🔔 PUSH NOTIFICATION SETUP
// ==========================================
webpush.setVapidDetails(
    `mailto:${process.env.EMAIL_USER}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

const otpVault = {}; 
const resetVault = {}; 

// ==========================================
// ☁️ CLOUDINARY UPLOAD CONFIGURATION
// ==========================================
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
const storage = new CloudinaryStorage({ cloudinary: cloudinary, params: { folder: 'mangakan_vault', allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp'] } });
const upload = multer({ storage: storage });

const mangaUploadFields = upload.fields([{ name: 'coverArt', maxCount: 1 }, { name: 'thumbnailArt', maxCount: 1 }, { name: 'bannerArt', maxCount: 1 }]);
const chapterUploadFields = upload.array('pages', 100); 
const avatarUploadField = upload.single('avatar'); 

// ==========================================
// 📜 SCHEMAS
// ==========================================
const userSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    avatarUrl: { type: String, default: '' }, 
    bio: { type: String, default: '' },      
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Manga' }], 
    pushSubscriptions: [{ type: Object }],
    // ✨ NEW: The Cloud Traveler's Log ✨
    readingProgress: [{ 
        mangaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Manga' }, 
        chapterIndex: Number,
        chapterNumber: Number,
        lastReadAt: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const mangaSchema = new mongoose.Schema({
    title: { type: String, required: true }, description: String, genres: [String],
    coverArt: String, thumbnailArt: String, bannerArt: String,
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
    views: { type: Number, default: 0 }, likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], 
    createdAt: { type: Date, default: Date.now }
});
const Manga = mongoose.model('Manga', mangaSchema);

const chapterSchema = new mongoose.Schema({
    mangaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Manga', required: true },
    chapterNumber: { type: Number, required: true }, title: { type: String }, pages: [{ type: String }], 
    createdAt: { type: Date, default: Date.now }
});
const Chapter = mongoose.model('Chapter', chapterSchema);

const commentSchema = new mongoose.Schema({
    mangaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Manga', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true }, createdAt: { type: Date, default: Date.now }
});
const Comment = mongoose.model('Comment', commentSchema);

// ==========================================
// ✨ CUTE EMAIL TEMPLATE GENERATOR ✨
// ==========================================
// ==========================================
// ✨ CUTE EMAIL TEMPLATE GENERATOR (MOBILE FIXED) ✨
// ==========================================
const createCuteEmail = (title, message, bigText, subText) => `
<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fcfcfd; font-family: 'Arial', sans-serif; padding: 20px 10px;">
    <tr>
        <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 450px; background: #ffffff; border-radius: 20px; border: 2px dashed #ff9a9e; margin: 0 auto;">
                <tr>
                    <td align="center" style="padding: 30px 20px;">
                        <h2 style="color: #2d3142; margin: 0 0 10px 0; font-size: 22px;">${title}</h2>
                        <p style="color: #8c92a4; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">${message}</p>
                        ${bigText ? `
                        <table cellpadding="0" cellspacing="0" style="margin: 0 auto 20px auto; background: #ff9a9e; border-radius: 16px;">
                            <tr>
                                <td align="center" style="padding: 15px 25px;">
                                    <h1 style="color: #ffffff; font-size: 28px; letter-spacing: 4px; margin: 0;">${bigText}</h1>
                                </td>
                            </tr>
                        </table>` : ''}
                        ${subText ? `<p style="font-size: 13px; color: #a18cd1; font-weight: bold; margin: 0;">${subText}</p>` : ''}
                        <div style="margin-top: 30px; border-top: 1px solid #fdf0f0; padding-top: 20px;">
                            <p style="font-size: 12px; color: #8c92a4; margin: 0;">With magic,<br>The Mangakan Mascot 🌸</p>
                        </div>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
`;

// ==========================================
// 🪄 API ENDPOINTS
// ==========================================

// ✨ NEW: SAVE CLOUD PROGRESS ✨
app.post('/api/save-progress', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { mangaId, chapterIndex, chapterNumber } = req.body;
        
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(404).json({ success: false });

        const progressIndex = user.readingProgress.findIndex(p => p.mangaId.toString() === mangaId);
        if (progressIndex > -1) {
            user.readingProgress[progressIndex].chapterIndex = chapterIndex;
            user.readingProgress[progressIndex].chapterNumber = chapterNumber;
            user.readingProgress[progressIndex].lastReadAt = Date.now();
        } else {
            user.readingProgress.push({ mangaId, chapterIndex, chapterNumber });
        }
        await user.save();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// ✨ NEW: FETCH CONTINUED READING ✨
app.get('/api/continue-reading', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await User.findById(decoded.userId).populate({ path: 'readingProgress.mangaId', model: 'Manga' });
        if (!user) return res.status(404).json({ success: false });

        const validProgress = user.readingProgress
            .filter(p => p.mangaId !== null)
            .sort((a, b) => b.lastReadAt - a.lastReadAt)
            .slice(0, 4); // Show top 4 recent reads
        
        res.json({ success: true, progress: validProgress });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/subscribe-push', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        await User.findByIdAndUpdate(decoded.userId, { $addToSet: { pushSubscriptions: req.body } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/broadcast', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user || !user.isAdmin) return res.status(403).json({ success: false });

        const { title, message } = req.body;
        const payload = JSON.stringify({ title: title || "✨ Guildmaster Message!", body: message, url: "https://mangakan.onrender.com/" });

        const users = await User.find({ pushSubscriptions: { $exists: true, $not: {$size: 0} } });
        let sentCount = 0;

        for (const u of users) {
            for (const sub of u.pushSubscriptions) {
                await webpush.sendNotification(sub, payload).catch(e => {
                    if (e.statusCode === 410 || e.statusCode === 404) { User.findByIdAndUpdate(u._id, { $pull: { pushSubscriptions: sub } }).exec(); }
                });
                sentCount++;
            }
        }
        res.json({ success: true, message: `Sent to ${sentCount} devices!` });
    } catch (error) { res.status(500).json({ success: false }); }
});

cron.schedule('0 15 * * *', async () => {
    const msgs = [
        { title: "🌸 Jash & Anna are waiting...", body: "Did you forget about them? Come read the next chapter!" },
        { title: "🥺 The library is so quiet...", body: "The Mangakan mascot is lonely! Come say hi! 👋" },
        { title: "✨ Your magical scrolls miss you!", body: "We saved your spot. Come back and explore today. 📖" }
    ];
    const rnd = msgs[Math.floor(Math.random() * msgs.length)];
    const payload = JSON.stringify({ title: rnd.title, body: rnd.body, url: "https://mangakan.onrender.com/" });

    try {
        const users = await User.find({ pushSubscriptions: { $exists: true, $not: {$size: 0} } });
        for (const user of users) {
            for (const sub of user.pushSubscriptions) {
                webpush.sendNotification(sub, payload).catch(e => {
                    if (e.statusCode === 410 || e.statusCode === 404) User.findByIdAndUpdate(user._id, { $pull: { pushSubscriptions: sub } }).exec();
                });
            }
        }
    } catch (err) { console.error(err); }
});

app.post('/api/google-auth', async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await googleClient.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const { email, name, picture } = ticket.getPayload();
        let user = await User.findOne({ email });

        if (!user) {
            const randomPassword = await bcrypt.hash(Math.random().toString(36).slice(-10), 10);
            user = new User({ username: name, email: email, password: randomPassword, avatarUrl: picture });
            await user.save();

            const mailOptions = {
                from: `"Mangakan Realm" <${process.env.EMAIL_USER}>`, to: email,
                subject: '🌸 Welcome to the Mangakan Realm!',
                html: createCuteEmail("🌸 Welcome to Mangakan!", `Hi ${name}! We are so happy you joined our beautiful comic sanctuary. Your magic journey begins now.`, null, "Happy reading!")
            };
            transporter.sendMail(mailOptions).catch(e => console.log(e));
        }

        const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token: jwtToken, message: 'Welcome to the Realm!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Google magic failed.' }); }
});

app.post('/api/send-otp', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: 'Email already in use!' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpVault[email] = { otp, username, password, expires: Date.now() + 300000 };

        const mailOptions = {
            from: `"Mangakan Realm" <${process.env.EMAIL_USER}>`, to: email,
            subject: '✨ Your Mangakan Verification Code',
            html: createCuteEmail("✨ Verify Your Magic", "You are one step away from joining the realm. Enter this code to open the gates:", otp, "This spell fades in 5 minutes.")
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'OTP sent to your email!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Failed to send email.' }); }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const storedData = otpVault[email];
        if (!storedData) return res.status(400).json({ success: false, message: 'OTP expired or not found.' });
        if (storedData.otp !== otp) return res.status(400).json({ success: false, message: 'Incorrect OTP code.' });
        if (Date.now() > storedData.expires) { delete otpVault[email]; return res.status(400).json({ success: false, message: 'OTP expired.' }); }

        const hashedPassword = await bcrypt.hash(storedData.password, 10);
        const newUser = new User({ username: storedData.username, email: email, password: hashedPassword });
        await newUser.save();
        delete otpVault[email];

        const mailOptions = {
            from: `"Mangakan Realm" <${process.env.EMAIL_USER}>`, to: email,
            subject: '🌸 Welcome to the Mangakan Realm!',
            html: createCuteEmail("🌸 Welcome to Mangakan!", `Hi ${storedData.username}! Your account has been magically created. Enjoy the library!`, null, "Happy reading!")
        };
        transporter.sendMail(mailOptions).catch(e=>console.log(e));

        const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, message: 'Welcome to the Realm!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error verifying code.' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, message: 'Traveler not found!' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: 'Incorrect password!' });
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, message: 'Welcome back!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error' }); }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, message: 'No traveler found!' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        resetVault[email] = { otp, expires: Date.now() + 300000 }; 

        const mailOptions = {
            from: `"Mangakan Realm" <${process.env.EMAIL_USER}>`, to: email,
            subject: '✨ Password Reset Code',
            html: createCuteEmail("🔒 Password Reset", "Forgot your magical key? No worries, use this code to create a new one:", otp, "This code is valid for 5 minutes.")
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Reset code sent to your email!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Failed to send email.' }); }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const storedData = resetVault[email];
        if (!storedData || storedData.otp !== otp) return res.status(400).json({ success: false, message: 'Invalid code.' });
        if (Date.now() > storedData.expires) { delete resetVault[email]; return res.status(400).json({ success: false, message: 'Code has expired.' }); }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findOneAndUpdate({ email }, { password: hashedPassword });
        delete resetVault[email]; 
        res.json({ success: true, message: 'Password successfully updated!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error resetting password.' }); }
});

app.get('/api/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'No key' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        res.json({ success: true, user });
    } catch (error) { res.status(500).json({ success: false, message: 'Invalid key' }); }
});

app.post('/api/update-profile', avatarUploadField, async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Must be logged in!' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { username, bio } = req.body;
        let updateData = { username, bio };
        if (req.file) updateData.avatarUrl = req.file.path; 
        const updatedUser = await User.findByIdAndUpdate(decoded.userId, updateData, { new: true }).select('-password');
        res.json({ success: true, message: 'Profile updated!', user: updatedUser });
    } catch (error) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.get('/api/me/mangas', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'No key' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userMangas = await Manga.find({ uploader: decoded.userId }).sort({ createdAt: -1 });
        res.json({ success: true, mangas: userMangas });
    } catch (error) { res.status(500).json({ success: false, message: 'Error loading profile mangas' }); }
});

app.post('/api/favorites/toggle', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Must be logged in!' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { mangaId } = req.body;
        const user = await User.findById(decoded.userId);
        const index = user.favorites.indexOf(mangaId);
        let isFavorited = false;
        if (index === -1) { user.favorites.push(mangaId); isFavorited = true; } 
        else { user.favorites.splice(index, 1); }
        await user.save();
        res.json({ success: true, isFavorited, message: isFavorited ? 'Added to library!' : 'Removed from library.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.get('/api/me/favorites', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Must be logged in!' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).populate('favorites');
        const validFavorites = user.favorites.filter(manga => manga !== null);
        res.json({ success: true, favorites: validFavorites });
    } catch (error) { res.status(500).json({ success: false, message: 'Error loading library' }); }
});

app.post('/api/upload-manga', mangaUploadFields, async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Must be logged in to summon!' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { title, description, genres } = req.body;
        const coverArtPath = req.files['coverArt'][0].path; 
        const newManga = new Manga({ title, description, genres: JSON.parse(genres || '[]'), coverArt: coverArtPath, uploader: decoded.userId });
        await newManga.save();
        res.json({ success: true, message: 'Manga registered!', coverUrl: coverArtPath, mangaId: newManga._id });
    } catch (error) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/upload-chapter', chapterUploadFields, async (req, res) => {
    try {
        const { mangaId, chapterNumber, title } = req.body;
        const pagesPaths = req.files ? req.files.map(file => file.path) : []; 
        const newChapter = new Chapter({ mangaId, chapterNumber, title, pages: pagesPaths });
        await newChapter.save();

        sendChapterNotifications(mangaId, chapterNumber, title).catch(err => console.log('Pigeon error:', err));
        res.json({ success: true, message: 'Chapter added & Subscribers notified!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Server error' }); }
});

async function sendChapterNotifications(mangaId, chapterNumber, chapterTitle) {
    const manga = await Manga.findById(mangaId);
    if (!manga) return;
    const subscribers = await User.find({ favorites: mangaId });
    if (subscribers.length === 0) return;

    const chapterNameText = chapterTitle ? `- ${chapterTitle}` : '';
    const mangaUrl = `https://mangakan.onrender.com/manga.html?id=${mangaId}&ch=${chapterNumber}`;
    const payload = JSON.stringify({ title: `✨ New Chapter: ${manga.title}`, body: `Chapter ${chapterNumber} ${chapterNameText} is out!`, url: mangaUrl });

    for (const sub of subscribers) {
        const mailOptions = {
            from: `"Mangakan Realm" <${process.env.EMAIL_USER}>`, to: sub.email,
            subject: `✨ New Chapter: ${manga.title} Chapter ${chapterNumber} is out!`,
            html: createCuteEmail("A new scroll has been summoned!", `<strong>${manga.title}</strong> just released <strong>Chapter ${chapterNumber} ${chapterNameText}</strong>.`, null, `<a href="${mangaUrl}" style="display: inline-block; padding: 15px 30px; background: #a18cd1; color: white; text-decoration: none; border-radius: 20px; font-weight: bold; margin-top: 20px;">Read it now</a>`)
        };
        await transporter.sendMail(mailOptions).catch(e => {});
        if (sub.pushSubscriptions && sub.pushSubscriptions.length > 0) {
            for (const pushSub of sub.pushSubscriptions) { webpush.sendNotification(pushSub, payload).catch(e => {}); }
        }
    }
}

app.post('/api/mangas/:id/view', async (req, res) => {
    try { await Manga.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/mangas/:id/like', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const manga = await Manga.findById(req.params.id);
        const index = manga.likes.indexOf(decoded.userId);
        let isLiked = false;
        if (index === -1) { manga.likes.push(decoded.userId); isLiked = true; } else { manga.likes.splice(index, 1); }
        await manga.save();
        res.json({ success: true, isLiked, likesCount: manga.likes.length });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/mangas/:id/comment', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const newComment = new Comment({ mangaId: req.params.id, user: decoded.userId, text: req.body.text });
        await newComment.save();
        const populatedComment = await Comment.findById(newComment._id).populate('user', 'username avatarUrl');
        res.json({ success: true, comment: populatedComment });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/mangas/:id/comments', async (req, res) => {
    try {
        const comments = await Comment.find({ mangaId: req.params.id }).populate('user', 'username avatarUrl').sort({ createdAt: -1 }); 
        res.json({ success: true, comments });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/mangas', async (req, res) => {
    try { const mangas = await Manga.find().sort({ createdAt: -1 }); res.json({ success: true, mangas }); } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/mangas/:id', async (req, res) => {
    try {
        const manga = await Manga.findById(req.params.id);
        const chapters = await Chapter.find({ mangaId: manga._id }).sort({ chapterNumber: 1 });
        res.json({ success: true, manga, chapters });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.delete('/api/mangas/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        const manga = await Manga.findById(req.params.id);
        if (manga.uploader.toString() !== decoded.userId && !user.isAdmin) return res.status(403).json({ success: false });
        await Manga.findByIdAndDelete(req.params.id);
        await Chapter.deleteMany({ mangaId: req.params.id });
        await Comment.deleteMany({ mangaId: req.params.id }); 
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/search', async (req, res) => {
    try {
        const { q, genre } = req.query;
        let query = {};
        if (q) query.$or = [{ title: { $regex: q, $options: 'i' } }, { description: { $regex: q, $options: 'i' } }];
        if (genre && genre !== 'All') query.genres = { $regex: genre, $options: 'i' };
        const mangas = await Manga.find(query).sort({ createdAt: -1 });
        res.json({ success: true, mangas });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user || !user.isAdmin) return res.status(403).json({ success: false });

        const totalUsers = await User.countDocuments();
        const totalMangas = await Manga.countDocuments();
        const allMangas = await Manga.find().sort({ createdAt: -1 });
        const totalViews = allMangas.reduce((sum, manga) => sum + (manga.views || 0), 0);
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json({ success: true, totalUsers, totalMangas, totalViews, users, mangas: allMangas });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.delete('/api/admin/mangas/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user || !user.isAdmin) return res.status(403).json({ success: false });
        await Manga.findByIdAndDelete(req.params.id);
        await Chapter.deleteMany({ mangaId: req.params.id });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.listen(PORT, () => console.log(`✨ Mangakan Server running at http://localhost:${PORT}`));