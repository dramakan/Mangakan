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

// ✨ NEW: Import Email Magic
const nodemailer = require('nodemailer');

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
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/// Temporary memory vault to hold OTPs before the account is fully created
const otpVault = {}; 
const resetVault = {}; // ✨ NEW: Memory vault for password resets

// ==========================================
// ☁️ CLOUDINARY UPLOAD CONFIGURATION
// ==========================================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: { folder: 'mangakan_vault', allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp'] }
});
const upload = multer({ storage: storage });

const mangaUploadFields = upload.fields([{ name: 'coverArt', maxCount: 1 }, { name: 'thumbnailArt', maxCount: 1 }, { name: 'bannerArt', maxCount: 1 }]);
const chapterUploadFields = upload.array('pages', 100); 
const avatarUploadField = upload.single('avatar'); 

// ==========================================
// 📜 SCHEMAS (The Blueprints)
// ==========================================
const userSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    avatarUrl: { type: String, default: '' }, 
    bio: { type: String, default: '' },      
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Manga' }], 
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const mangaSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: String,
    genres: [String],
    coverArt: String,
    thumbnailArt: String,
    bannerArt: String,
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
    views: { type: Number, default: 0 }, 
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], 
    createdAt: { type: Date, default: Date.now }
});
const Manga = mongoose.model('Manga', mangaSchema);

const chapterSchema = new mongoose.Schema({
    mangaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Manga', required: true },
    chapterNumber: { type: Number, required: true },
    title: { type: String }, 
    pages: [{ type: String }], 
    createdAt: { type: Date, default: Date.now }
});
const Chapter = mongoose.model('Chapter', chapterSchema);

const commentSchema = new mongoose.Schema({
    mangaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Manga', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Comment = mongoose.model('Comment', commentSchema);

// ==========================================
// 🪄 API ENDPOINTS
// ==========================================

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
            from: `"Mangakan Realm" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '✨ Your Mangakan Verification Code',
            html: `
                <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; color: #2d3142;">
                    <h2 style="color: #ff9a9e;">Welcome to Mangakan!</h2>
                    <p>You are one step away from joining the realm.</p>
                    <p>Your magical verification code is:</p>
                    <h1 style="background: #fcfcfd; border: 2px dashed #a18cd1; padding: 15px; letter-spacing: 5px; color: #a18cd1;">${otp}</h1>
                    <p style="font-size: 12px; color: #8c92a4;">This code will expire in 5 minutes.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'OTP sent to your email!' });

    } catch (error) { 
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to send email. Check your server logs.' }); 
    }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const storedData = otpVault[email];

        if (!storedData) return res.status(400).json({ success: false, message: 'OTP expired or not found. Try again.' });
        if (storedData.otp !== otp) return res.status(400).json({ success: false, message: 'Incorrect OTP code.' });
        if (Date.now() > storedData.expires) {
            delete otpVault[email];
            return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
        }

        const hashedPassword = await bcrypt.hash(storedData.password, 10);
        const newUser = new User({ username: storedData.username, email: email, password: hashedPassword });
        await newUser.save();
        
        delete otpVault[email];

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
        if (!user) return res.status(400).json({ success: false, message: 'No traveler found with this email!' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        resetVault[email] = { otp, expires: Date.now() + 300000 }; 

        const mailOptions = {
            from: `"Mangakan Realm" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '✨ Password Reset Code',
            html: `
                <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; color: #2d3142;">
                    <h2 style="color: #ff9a9e;">Password Reset Request</h2>
                    <p>Here is your magical code to reset your password:</p>
                    <h1 style="background: #fcfcfd; border: 2px dashed #a18cd1; padding: 15px; letter-spacing: 5px; color: #a18cd1;">${otp}</h1>
                    <p style="font-size: 12px; color: #8c92a4;">This code will expire in 5 minutes.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Reset code sent to your email!' });
    } catch (error) { 
        res.status(500).json({ success: false, message: 'Failed to send email.' }); 
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const storedData = resetVault[email];

        if (!storedData) return res.status(400).json({ success: false, message: 'Code expired or not found.' });
        if (storedData.otp !== otp) return res.status(400).json({ success: false, message: 'Incorrect code.' });
        if (Date.now() > storedData.expires) {
            delete resetVault[email];
            return res.status(400).json({ success: false, message: 'Code has expired.' });
        }

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

// ✨ UPGRADED: UPLOAD CHAPTER & NOTIFY SUBSCRIBERS ✨
app.post('/api/upload-chapter', chapterUploadFields, async (req, res) => {
    try {
        const { mangaId, chapterNumber, title } = req.body;
        const pagesPaths = req.files ? req.files.map(file => file.path) : []; 
        const newChapter = new Chapter({ mangaId, chapterNumber, title, pages: pagesPaths });
        await newChapter.save();

        // 🕊️ Trigger the messenger pigeons (Runs in background so it doesn't freeze the upload)
        sendChapterNotifications(mangaId, chapterNumber, title).catch(err => console.log('Pigeon error:', err));

        res.json({ success: true, message: 'Chapter added & Subscribers notified!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// 🕊️ HELPER SPELL: Sends emails to anyone who favorited this manga
async function sendChapterNotifications(mangaId, chapterNumber, chapterTitle) {
    const manga = await Manga.findById(mangaId);
    if (!manga) return;

    // Find all users who have this manga's ID saved in their favorites array
    const subscribers = await User.find({ favorites: mangaId });
    if (subscribers.length === 0) return;

    const chapterNameText = chapterTitle ? `- ${chapterTitle}` : '';
    // The exact link to the specific chapter!
    const mangaUrl = `https://mangakan.onrender.com/manga.html?id=${mangaId}&ch=${chapterNumber}`;

    for (const sub of subscribers) {
        const mailOptions = {
            from: `"Mangakan Realm" <${process.env.EMAIL_USER}>`,
            to: sub.email,
            subject: `✨ New Chapter: ${manga.title} Chapter ${chapterNumber} is out!`,
            html: `
                <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; color: #2d3142;">
                    <h2 style="color: #ff9a9e;">A new scroll has been summoned!</h2>
                    <p><strong>${manga.title}</strong> just released <strong>Chapter ${chapterNumber} ${chapterNameText}</strong>.</p>
                    <a href="${mangaUrl}" style="display: inline-block; padding: 15px 30px; background: #a18cd1; color: white; text-decoration: none; border-radius: 20px; font-weight: bold; margin-top: 20px;">Read it now</a>
                </div>
            `
        };
        // Send email individually
        await transporter.sendMail(mailOptions);
    }
}

app.post('/api/mangas/:id/view', async (req, res) => {
    try {
        await Manga.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/mangas/:id/like', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Must be logged in!' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const manga = await Manga.findById(req.params.id);
        const index = manga.likes.indexOf(decoded.userId);
        let isLiked = false;
        if (index === -1) { manga.likes.push(decoded.userId); isLiked = true; } 
        else { manga.likes.splice(index, 1); }
        await manga.save();
        res.json({ success: true, isLiked, likesCount: manga.likes.length });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/mangas/:id/comment', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Must be logged in!' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const newComment = new Comment({ mangaId: req.params.id, user: decoded.userId, text: req.body.text });
        await newComment.save();
        const populatedComment = await Comment.findById(newComment._id).populate('user', 'username avatarUrl');
        res.json({ success: true, comment: populatedComment });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/mangas/:id/comments', async (req, res) => {
    try {
        const comments = await Comment.find({ mangaId: req.params.id }).populate('user', 'username avatarUrl').sort({ createdAt: -1 }); 
        res.json({ success: true, comments });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/mangas', async (req, res) => {
    try {
        const mangas = await Manga.find().sort({ createdAt: -1 });
        res.json({ success: true, mangas });
    } catch (error) { res.status(500).json({ success: false, message: 'Error' }); }
});

app.get('/api/mangas/:id', async (req, res) => {
    try {
        const manga = await Manga.findById(req.params.id);
        if (!manga) return res.status(404).json({ success: false, message: 'Manga not found.' });
        const chapters = await Chapter.find({ mangaId: manga._id }).sort({ chapterNumber: 1 });
        res.json({ success: true, manga, chapters });
    } catch (error) { res.status(500).json({ success: false, message: 'Error' }); }
});

app.delete('/api/mangas/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Must be logged in' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        const manga = await Manga.findById(req.params.id);
        if (!manga) return res.status(404).json({ success: false, message: 'Manga not found' });

        const uploaderId = manga.uploader ? manga.uploader.toString() : null;
        if (uploaderId !== decoded.userId && !user.isAdmin) {
            return res.status(403).json({ success: false, message: 'Only the creator or Guildmaster can banish this!' });
        }

        await Manga.findByIdAndDelete(req.params.id);
        await Chapter.deleteMany({ mangaId: req.params.id });
        await Comment.deleteMany({ mangaId: req.params.id }); 
        res.json({ success: true, message: 'Manga banished to the void.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error deleting.' }); }
});

app.get('/api/search', async (req, res) => {
    try {
        const { q, genre } = req.query;
        let query = {};
        
        if (q) {
            query.$or = [
                { title: { $regex: q, $options: 'i' } },
                { description: { $regex: q, $options: 'i' } }
            ];
        }
        
        if (genre && genre !== 'All') {
            query.genres = { $regex: genre, $options: 'i' };
        }
        
        const mangas = await Manga.find(query).sort({ createdAt: -1 });
        res.json({ success: true, mangas });
    } catch (error) { 
        console.error("Search Error:", error);
        res.status(500).json({ success: false, message: 'Search magic failed.' }); 
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'No key' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.userId);
        if (!user || !user.isAdmin) return res.status(403).json({ success: false, message: 'Not a Guildmaster!' });

        const totalUsers = await User.countDocuments();
        const totalMangas = await Manga.countDocuments();
        
        const allMangas = await Manga.find().sort({ createdAt: -1 });
        const totalViews = allMangas.reduce((sum, manga) => sum + (manga.views || 0), 0);

        const users = await User.find().select('-password').sort({ createdAt: -1 });

        res.json({ success: true, totalUsers, totalMangas, totalViews, users, mangas: allMangas });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Admin magic failed.' });
    }
});

app.delete('/api/admin/mangas/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'No key' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.userId);
        if (!user || !user.isAdmin) return res.status(403).json({ success: false, message: 'Not a Guildmaster!' });

        await Manga.findByIdAndDelete(req.params.id);
        await Chapter.deleteMany({ mangaId: req.params.id });

        res.json({ success: true, message: 'Manga permanently banished by Guildmaster!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to banish manga.' });
    }
});

app.listen(PORT, () => console.log(`✨ Mangakan Server running at http://localhost:${PORT}`));