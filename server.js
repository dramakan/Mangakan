require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 

// ✨ NEW: Import Cloudinary Magic
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000; // Let Render choose the port

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('🔮 Connected to the MongoDB Magic Vault!'))
    .catch(err => console.error('❌ Failed to connect to MongoDB:', err));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(express.static('public'));

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
    params: {
        folder: 'mangakan_vault', // It will create this folder in your Cloudinary!
        allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp']
    }
});
const upload = multer({ storage: storage });

// The upload fields
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

// ==========================================
// 🪄 API ENDPOINTS
// ==========================================

app.post('/api/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: 'Email already in use!' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword });
        await newUser.save();
        const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, message: 'Welcome to the Realm!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error' }); }
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
        
        // ✨ NOW SAVES THE CLOUDINARY SECURE URL
        if (req.file) updateData.avatarUrl = req.file.path; 
        
        const updatedUser = await User.findByIdAndUpdate(decoded.userId, updateData, { new: true }).select('-password');
        res.json({ success: true, message: 'Profile updated!', user: updatedUser });
    } catch (error) { res.status(500).json({ success: false, message: 'Server error during update' }); }
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
        
        // ✨ NOW SAVES THE CLOUDINARY SECURE URL
        const coverArtPath = req.files['coverArt'][0].path; 
        
        const newManga = new Manga({ title, description, genres: JSON.parse(genres || '[]'), coverArt: coverArtPath, uploader: decoded.userId });
        await newManga.save();
        res.json({ success: true, message: 'Manga registered!', coverUrl: coverArtPath, mangaId: newManga._id });
    } catch (error) { console.error(error); res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/upload-chapter', chapterUploadFields, async (req, res) => {
    try {
        const { mangaId, chapterNumber, title } = req.body;
        
        // ✨ NOW SAVES ARRAY OF CLOUDINARY SECURE URLS
        const pagesPaths = req.files ? req.files.map(file => file.path) : []; 
        
        const newChapter = new Chapter({ mangaId, chapterNumber, title, pages: pagesPaths });
        await newChapter.save();
        res.json({ success: true, message: 'Chapter added!' });
    } catch (error) { console.error(error); res.status(500).json({ success: false, message: 'Server error' }); }
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
        res.json({ success: true, message: 'Manga banished to the void.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error deleting.' }); }
});

app.get('/api/search', async (req, res) => {
    try {
        const { q, genre } = req.query;
        let query = {};
        if (q) query.title = { $regex: q, $options: 'i' }; 
        if (genre && genre !== 'All') query.genres = genre; 
        const mangas = await Manga.find(query).sort({ createdAt: -1 });
        res.json({ success: true, mangas });
    } catch (error) { res.status(500).json({ success: false, message: 'Search magic failed.' }); }
});

app.listen(PORT, () => console.log(`✨ Mangakan Server running at http://localhost:${PORT}`));