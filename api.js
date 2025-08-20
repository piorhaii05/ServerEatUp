const express = require('express');
const mongoose = require('mongoose');
const { UserModel, ProductModel, CategoryModel, CartModel, FavoriteModel, AddressModel, BankModel, OrderModel, VoucherModel, ReviewSModel, MessageModel, ConversationModel } = require('./eatUpModel');
const COMMON = require('./COMMON');

const router = express.Router();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const querystring = require('qs');

const multer = require('multer');
const path = require('path');

const moment = require('moment-timezone');

const axios = require('axios');

module.exports = router;



// Upload ảnh
// Khởi tạo multer để lưu trữ file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // **Quan trọng:** Đảm bảo thư mục 'uploads' này tồn tại
        // trong thư mục gốc của dự án backend của bạn.
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        // Đổi tên file để tránh trùng lặp, ví dụ: timestamp + đuôi file gốc
        // Đây sẽ là "linkanh" trong đường dẫn "uploads/linkanh.jpg" của bạn.
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Ngân hàng: NCB
// Số thẻ: 9704198526191432198
// Tên chủ thẻ:NGUYEN VAN A
// Ngày phát hành:07/15
// Mật khẩu OTP:123456


const config = {
    app_id: 553, // app_id test
    key1: "9phuAOYhan4urywHTh0ndEXiV3pKHr5Q", // key1 test
    key2: "Iyz2habzyr7AG8SgvoBCbKwKi3UzlLi3", // key2 test
    // Endpoint tạo đơn hàng
    create_endpoint: "https://sb-openapi.zalopay.vn/v2/create", 
    // Endpoint kiểm tra trạng thái
    status_endpoint: "https://sb-openapi.zalopay.vn/v2/query",
};

// API tạo đơn hàng ZaloPay
router.post("/zalopay/create", async (req, res) => {
    try {
        const { amount, orderData } = req.body;
        
        // Đảm bảo dữ liệu cần thiết đã được truyền lên
        if (!amount || !orderData) {
            return res.status(400).json({ message: "Missing amount or order data" });
        }

        const embed_data = {
            redirecturl: "eatup://zalopay",
            order_id_backend: orderData.order_id,
        };

        const items = orderData.items.map(item => ({
            item_id: item.product_id,
            item_name: item.product_title,
            item_price: item.price_at_order,
            item_quantity: item.quantity
        }));
        
        // Tạo app_trans_id duy nhất
        const transID = Math.floor(Math.random() * 1000000);
        const app_trans_id = `${moment().format('YYMMDD')}_${transID}`;
        const app_time = Date.now();

        // Chuẩn bị payload cho ZaloPay
        const order = {
            app_id: config.app_id,
            app_trans_id: app_trans_id,
            app_user: "eatup_user_" + orderData.user_id, // Sử dụng ID người dùng thật
            app_time: app_time,
            item: JSON.stringify(items),
            embed_data: JSON.stringify(embed_data),
            amount: amount,
            description: `Thanh toán đơn hàng EatUp #${app_trans_id}`,
            bank_code: "zalopayapp",
        };

        // Tạo chuỗi MAC để xác thực
        // *** ĐÃ SỬA: Sử dụng các biến đã được stringify để tạo MAC ***
        const data = `${order.app_id}|${order.app_trans_id}|${order.app_user}|${order.amount}|${order.app_time}|${order.embed_data}|${order.item}`;
        order.mac = crypto
            .createHmac("sha256", config.key1)
            .update(data)
            .digest("hex");

        // Gửi request đến ZaloPay
        const result = await axios.post(config.create_endpoint, null, { params: order });
        
        if (result.data.return_code === 1) {
            // Lưu app_trans_id vào database để kiểm tra sau này
            await OrderModel.findByIdAndUpdate(orderData.order_id, { zalo_trans_id: app_trans_id });
        }

        res.json(result.data);
    } catch (error) {
        console.error("Lỗi khi tạo đơn hàng ZaloPay:", error.response?.data || error.message);
        res.status(500).json({ message: "Lỗi tạo đơn hàng", error: error.message });
    }
});

// API kiểm tra trạng thái giao dịch
// *** ĐÃ SỬA: Đổi endpoint và sửa lỗi tên biến, lỗi logic ***
router.post('/zalopay/check-status', async (req, res) => {
    try {
        console.log('--- Bắt đầu xử lý kiểm tra trạng thái ZaloPay ---');
        console.log('Request body:', req.body);
        
        // Sửa tên biến từ 'app_trans_id' sang 'apptransid' để khớp với frontend
        const { apptransid } = req.body;

        if (!apptransid) {
            console.error('Lỗi: Thiếu apptransid');
            return res.status(400).json({ message: 'Missing apptransid' });
        }

        const data = {
            app_id: config.app_id,
            app_trans_id: apptransid
        };

        // Chuỗi MAC để xác thực
        const mac = crypto.createHmac('sha256', config.key1)
            .update(data.app_id + '|' + data.app_trans_id + '|' + config.key1) // Theo tài liệu ZaloPay
            .digest('hex');

        // Gửi yêu cầu truy vấn đến API ZaloPay
        const response = await axios.post(config.status_endpoint, querystring.stringify({ ...data, mac: mac }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        console.log('Phản hồi từ ZaloPay:', response.data);
        res.json(response.data);

    } catch (error) {
        console.error('Lỗi khi kiểm tra trạng thái ZaloPay:', error.response?.data || error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// API callback (ZaloPay sẽ gọi về khi thanh toán xong)
router.post("/zalopay/callback", (req, res) => {
    let result = {};
    try {
        let dataStr = req.body.data;
        let reqMac = req.body.mac;
        let mac = crypto.createHmac("sha256", config.key2).update(dataStr).digest("hex");

        if (reqMac !== mac) {
            result.return_code = -1;
            result.return_message = "mac not equal";
        } else {
            let dataJson = JSON.parse(dataStr);
            console.log("Thanh toán thành công:", dataJson);
            // Sau khi thanh toán thành công, bạn có thể cập nhật trạng thái đơn hàng tại đây
            // Ví dụ:
            // const orderId = dataJson.embed_data.order_id_backend;
            // await OrderModel.findByIdAndUpdate(orderId, { status: 'Paid' });
            
            result.return_code = 1;
            result.return_message = "success";
        }
    } catch (ex) {
        result.return_code = 0;
        result.return_message = ex.message;
    }
    res.json(result);
});

// Route để xử lý tải lên ảnh
router.post('/upload', upload.single('image'), (req, res) => {
    // 'image' ở đây phải khớp với tên trường bạn gửi từ FormData ở frontend (`formData.append('image', ...)`).
    if (req.file) {
        // **Backend trả về tên file và đường dẫn tương đối (để frontend sử dụng)**
        // Ví dụ: filename: "1678901234567-12345.jpg", url: "/uploads/1678901234567-12345.jpg"
        res.status(200).json({
            message: 'Upload thành công',
            filename: req.file.filename,
            url: `uploads/${req.file.filename}` // Đây là đường dẫn tương đối bạn muốn
        });
    } else {
        res.status(400).json({ message: 'Không tìm thấy file ảnh' });
    }
});
// Test
router.get('/', (req, res) => {
    res.send('Vào API mobile');
});

// ------------------ USER ------------------

// Lấy danh sách user
router.get('/list', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const users = await UserModel.find();
    res.send(users);
});

// Thêm user
router.post('/add', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const newUser = req.body;
        const user = await UserModel.create(newUser);
        res.status(200).send(user);
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).send({ message: 'Email đã tồn tại!' });
        } else {
            res.status(500).send({ message: 'Lỗi server!', error: error.message });
        }
    }
});

// Sửa user
router.put('/update/:id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const id = req.params.id;
    const updatedUser = await UserModel.findByIdAndUpdate(id, req.body, { new: true });
    res.send(updatedUser);
});

// Xóa user
router.delete('/delete/:id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const deleted = await UserModel.findByIdAndDelete(req.params.id);
    res.send({ message: 'Đã xóa', data: deleted });
});

// Đăng nhập
router.post('/login', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const { email, password_hash, role } = req.body;

        if (!email || !password_hash || !role) {
            return res.status(400).send({ message: 'Thiếu thông tin đăng nhập!' });
        }

        const user = await UserModel.findOne({ email, role });

        // --- BƯỚC 1: KIỂM TRA USER CÓ TỒN TẠI KHÔNG ---
        if (!user) {
            return res.status(401).send({ message: 'Thông tin tài khoản của bạn không chính xác!' });
        }

        // --- BƯỚC 2: KIỂM TRA TRẠNG THÁI 'block' ---
        // Nếu trường 'block' là true, tức là tài khoản bị khóa
        if (user.block) {
            return res.status(403).send({ message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên!' });
        }

        // --- BƯỚC 3: KIỂM TRA MẬT KHẨU ---
        // LƯU Ý: Hiện tại bạn đang so sánh chuỗi password_hash trực tiếp.
        // Đây KHÔNG PHẢI là cách an toàn. Bạn NÊN sử dụng bcrypt để so sánh mật khẩu đã mã hóa.
        // Ví dụ: if (!(await bcrypt.compare(password_hash, user.password_hash))) { ... }
        if (user.password_hash !== password_hash) {
            return res.status(401).send({ message: 'Thông tin tài khoản của bạn không chính xác!' });
        }

        // Trả về thông tin cần thiết, ép _id thành string, không gửi password_hash
        res.status(200).send({
            message: 'Đăng nhập thành công!',
            user: {
                _id: user._id.toString(),
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                avatar_url: user.avatar_url,
                gender: user.gender || 'Chưa cập nhập',
                rating: user.rating,
                num_reviews: user.num_reviews,
                // Không cần gửi trường 'block' về frontend nếu bạn không muốn hiển thị
                // hoặc xử lý đặc biệt ở phía client
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Lỗi server!', error: error.message });
    }
});

router.put('/change-password/:id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const { old_password, new_password } = req.body;
        const user = await UserModel.findById(req.params.id);

        if (!user) {
            return res.status(404).send({ message: 'Không tìm thấy người dùng' });
        }

        if (user.password_hash !== old_password) {
            return res.status(400).send({ message: 'Mật khẩu cũ không đúng!' });
        }

        user.password_hash = new_password;
        await user.save();

        res.send({ message: 'Đổi mật khẩu thành công!' });
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Lỗi server!', error: error.message });
    }
});

// ------------------ PRODUCT ------------------

// Lấy tất cả sản phẩm
router.get('/product', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const products = await ProductModel.find();
    res.send(products);
});

// Lấy sản phẩm theo id
router.get('/product/by-restaurant/:restaurant_id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const products = await ProductModel.find({ restaurant_id: req.params.restaurant_id });
    res.send(products);
});


// Thêm sản phẩm mới
router.post('/product', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { restaurant_id, name, price } = req.body;

    if (!restaurant_id || !name || !price) {
        return res.status(400).send({ message: 'Thiếu dữ liệu bắt buộc!' });
    }

    try {
        const product = await ProductModel.create(req.body);
        res.send(product);
    } catch (err) {
        res.status(500).send(err);
    }
});

// Xóa sản phẩm
router.delete('/product/:id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    await ProductModel.findByIdAndDelete(req.params.id);
    res.send({ message: 'Đã xóa sản phẩm' });
});

// Sửa sản phẩm
router.put('/product/:id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const updated = await ProductModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.send(updated);
});

// Lấy sản phẩm phổ biến theo rating giảm dần và chỉ lấy sản phẩm đang mở bán, rating > 4.5
router.get('/product/highest-rated', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const { city } = req.query;

        let query = {
            status: true,
            rating: { $gt: 4.5 }
        };

        // Nếu city tồn tại và không phải là chuỗi rỗng, thì mới lọc
        if (city && city.trim() !== '') {
            const restaurantsInCity = await AddressModel.find({ city: city }, { user_id: 1, _id: 0 }).lean();
            const restaurantIds = restaurantsInCity.map(r => r.user_id);
            query.restaurant_id = { $in: restaurantIds };
        }

        const products = await ProductModel.find(query)
            .sort({ rating: -1 })
            .limit(10);

        res.status(200).json(products);
    } catch (error) {
        console.error('Lỗi khi lấy sản phẩm đánh giá cao:', error);
        res.status(500).json({ message: 'Lỗi server!', error: error.message });
    }
});

router.get('/admin/product/:id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri); // Đảm bảo kết nối MongoDB
        const product = await ProductModel.findById(req.params.id);

        if (!product) {
            // Nếu không tìm thấy sản phẩm, trả về 404 với JSON
            return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' }); // <-- Sử dụng .json()
        }

        // Nếu tìm thấy, trả về sản phẩm dưới dạng JSON
        res.json(product); // <-- Sử dụng .json()

    } catch (error) {
        console.error("Lỗi khi lấy sản phẩm theo ID:", error);
        // Trả về lỗi server 500 với JSON
        res.status(500).json({ message: 'Lỗi server khi lấy chi tiết sản phẩm.', error: error.message }); // <-- Sử dụng .json()
    }
});

// Sản phẩm phổ biến theo số lượt mua cao nhất
router.get('/product/popular', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const { city } = req.query;

        let query = {
            status: true
        };

        // Nếu city tồn tại và không phải là chuỗi rỗng, thì mới lọc
        if (city && city.trim() !== '') {
            const restaurantsInCity = await AddressModel.find({ city: city }, { user_id: 1, _id: 0 }).lean();
            const restaurantIds = restaurantsInCity.map(r => r.user_id);
            query.restaurant_id = { $in: restaurantIds };
        }

        const products = await ProductModel.find(query)
            .sort({ purchases: -1 })
            .limit(7);

        res.status(200).json(products);
    } catch (error) {
        console.error('Lỗi khi lấy sản phẩm phổ biến:', error);
        res.status(500).json({ message: 'Lỗi server!', error: error.message });
    }
});

// Sản phẩm mới nhất theo ngày thêm (giảm dần)
router.get('/product/newest', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const { city } = req.query;

        let query = {
            status: true
        };

        // Nếu city tồn tại và không phải là chuỗi rỗng, thì mới lọc
        if (city && city.trim() !== '') {
            const restaurantsInCity = await AddressModel.find({ city: city }, { user_id: 1, _id: 0 }).lean();
            const restaurantIds = restaurantsInCity.map(r => r.user_id);
            query.restaurant_id = { $in: restaurantIds };
        }

        const newestProducts = await ProductModel.find(query)
            .sort({ createAt: -1 })
            .limit(10);
        res.status(200).json(newestProducts);
    } catch (error) {
        console.error('Lỗi khi lấy sản phẩm mới nhất:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});
// router.get('/product/search', async (req, res) => {
//     console.log('Received search request');
//     const { name } = req.query;
//     console.log('Search query:', name); // Kiểm tra xem `name` có nhận được không

//     if (!name) {
//         console.log('No search name provided, returning 400.');
//         return res.status(400).json({ message: 'Vui lòng cung cấp từ khóa tìm kiếm (name).' });
//     }

//     try {
//         // Kiểm tra xem Product model có được import đúng không
//         // console.log('Product model:', Product); 
//         const products = await ProductModel.find({
//             name: { $regex: name, $options: 'i' },
//             status: true
//         });
//         console.log('Found products:', products.length);
//         res.json(products);
//     } catch (err) {
//         console.error("Error in product search:", err); // In lỗi chi tiết
//         res.status(500).json({ message: 'Lỗi server khi tìm kiếm sản phẩm.' });
//     }
// });


router.get('/search', async (req, res) => { // Đổi tên endpoint thành /search
    console.log('Received combined search request');
    const { q } = req.query; // Đổi tên query param thành 'q' cho từ khóa chung
    console.log('Combined search query:', q);

    if (!q) {
        return res.status(400).json({ message: 'Vui lòng cung cấp từ khóa tìm kiếm.' });
    }

    try {
        // Tìm kiếm sản phẩm
        const products = await ProductModel.find({
            name: { $regex: q, $options: 'i' },
            status: true
        });
        console.log('Found products:', products.length);

        // Tìm kiếm nhà hàng (người dùng có role là admin)
        const restaurants = await UserModel.find({
            role: 'Admin',
            name: { $regex: q, $options: 'i' },
            // Thêm các điều kiện khác nếu cần, ví dụ: isActive: true
        });
        console.log('Found restaurants (Admin Users):', restaurants.length);

        // Mapping lại dữ liệu nhà hàng nếu cần (giống như Lựa chọn 1)
        const formattedRestaurants = restaurants.map(restaurant => ({
            _id: restaurant._id,
            name: restaurant.name,
            phone: restaurant.phone,
            image_url: restaurant.avatar_url,
            avgRating: restaurant.rating || null,
            // ...
        }));

        // Trả về cả hai kết quả trong một object
        res.json({ products, restaurants: formattedRestaurants }); // Đổi tên key thành 'restaurants' cho rõ ràng
    } catch (err) {
        console.error("Error in combined search:", err);
        res.status(500).json({ message: 'Lỗi server khi thực hiện tìm kiếm.' });
    }
});

// ------------------ CATEGORY ------------------

// Lấy danh sách category (hiển thị ảnh luôn)
router.get('/category', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const categories = await CategoryModel.find();
    res.send(categories);
});

// ------------------ CART ------------------

// Lấy giỏ hàng theo user_id
router.get('/cart/:user_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const cart = await CartModel.findOne({ user_id: req.params.user_id });

        if (!cart || cart.items.length === 0) {
            return res.send({ user_id: req.params.user_id, items: [] });
        }

        // Tạo một đối tượng Map để lưu trữ thông tin nhà hàng và sản phẩm
        const detailedItemsMap = {};

        // Lấy thông tin chi tiết của từng sản phẩm và nhà hàng liên quan
        for (const item of cart.items) {
            const product = await ProductModel.findById(item.product_id);
            if (product) {
                const restaurant = await UserModel.findById(product.restaurant_id);

                detailedItemsMap[item.product_id] = {
                    product_id: item.product_id,
                    quantity: item.quantity,
                    product_name: product.name,
                    product_image: product.image_url,
                    product_price: product.price,
                    restaurant_id: product.restaurant_id,
                    restaurant_name: restaurant?.name || 'Không xác định'
                };
            }
        }

        // Chuyển đổi Map thành mảng để gửi về
        const detailedItems = Object.values(detailedItemsMap);

        res.send({
            user_id: req.params.user_id,
            items: detailedItems
        });
    } catch (error) {
        console.error('Lỗi khi lấy giỏ hàng:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy giỏ hàng.', error: error.message });
    }
});


// Thêm hoặc cập nhật sản phẩm trong giỏ hàng
// router.post('/cart/add', async (req, res) => {
//     await mongoose.connect(COMMON.uri);
//     const { user_id, product_id, quantity } = req.body;

//     const product = await ProductModel.findById(product_id);
//     if (!product) {
//         return res.status(404).send({ message: 'Sản phẩm không tồn tại' });
//     }

//     const restaurant_id = product.restaurant_id;

//     let cart = await CartModel.findOne({ user_id });

//     if (!cart) {
//         cart = await CartModel.create({
//             user_id,
//             items: [{ product_id, quantity, restaurant_id }]
//         });
//     } else {
//         const existingItem = cart.items.find(item => item.product_id === product_id);
//         if (existingItem) {
//             existingItem.quantity += quantity;
//         } else {
//             cart.items.push({ product_id, quantity, restaurant_id });
//         }
//         await cart.save();
//     }

//     res.send(cart);
// });

router.post('/cart/add', async (req, res) => {
    try {
        const { user_id, product_id, quantity } = req.body;

        // 1. Kiểm tra đầu vào hợp lệ
        if (!user_id || !product_id || quantity === undefined) {
            return res.status(400).json({ message: 'Thiếu thông tin bắt buộc: user_id, product_id, hoặc quantity.' });
        }
        if (!mongoose.Types.ObjectId.isValid(user_id) || !mongoose.Types.ObjectId.isValid(product_id)) {
            return res.status(400).json({ message: 'ID người dùng hoặc sản phẩm không hợp lệ.' });
        }

        // 2. Tìm hoặc tạo giỏ hàng cho người dùng
        let cart = await CartModel.findOne({ user_id });

        if (!cart) {
            // Tạo giỏ hàng mới nếu chưa có
            cart = new CartModel({
                user_id,
                items: [{ product_id, quantity }]
            });
            await cart.save();
            return res.status(201).json({ message: 'Giỏ hàng mới đã được tạo và sản phẩm đã được thêm.', cart });
        }

        // 3. Giỏ hàng đã tồn tại, kiểm tra sản phẩm
        const existingItemIndex = cart.items.findIndex(item => item.product_id.toString() === product_id);

        if (existingItemIndex > -1) {
            // Sản phẩm đã có trong giỏ, tăng số lượng
            cart.items[existingItemIndex].quantity += quantity;
        } else {
            // Sản phẩm chưa có, thêm mới vào giỏ
            cart.items.push({ product_id, quantity });
        }
        await cart.save();

        res.status(200).json({ message: 'Sản phẩm đã được cập nhật vào giỏ hàng.', cart });

    } catch (error) {
        console.error('Lỗi khi thêm sản phẩm vào giỏ hàng:', error);
        res.status(500).json({ message: 'Lỗi server khi thêm sản phẩm vào giỏ hàng.', error: error.message });
    }
});

// Cập nhật số lượng sản phẩm trong giỏ hàng
router.put('/cart/update', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { user_id, product_id, quantity } = req.body;

    if (!user_id || !product_id || quantity === undefined) {
        return res.status(400).send({ message: 'Thiếu dữ liệu' });
    }

    const cart = await CartModel.findOne({ user_id });

    if (cart) {
        const item = cart.items.find(item => item.product_id === product_id);
        if (item) {
            item.quantity = quantity;
            await cart.save();
            return res.send(cart);
        }
    }

    res.status(404).send({ message: 'Không tìm thấy sản phẩm trong giỏ' });
});

// Xóa sản phẩm khỏi giỏ hàng
router.delete('/cart/remove', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { user_id, product_id } = req.body;

    if (!user_id || !product_id) {
        return res.status(400).send({ message: 'Thiếu dữ liệu' });
    }

    const cart = await CartModel.findOne({ user_id });

    if (cart) {
        cart.items = cart.items.filter(item => item.product_id !== product_id);
        await cart.save();
        return res.send(cart);
    }

    res.status(404).send({ message: 'Không tìm thấy giỏ hàng' });
});

router.delete('/cart/remove-multiple', async (req, res) => {
    try {
        const { user_id, product_ids } = req.body;

        if (!user_id || !Array.isArray(product_ids) || product_ids.length === 0) {
            return res.status(400).json({ message: 'user_id và product_ids (mảng không rỗng) là bắt buộc.' });
        }

        let cart = await CartModel.findOne({ user_id });

        if (!cart) {
            return res.status(404).json({ message: 'Không tìm thấy giỏ hàng của người dùng.' });
        }

        // SỬA LỖI TẠI ĐÂY: Dùng "cart.items" thay vì "cart.products"
        cart.items = cart.items.filter(item => !product_ids.includes(item.product_id.toString()));

        await cart.save();

        return res.json({ message: 'Đã xóa các sản phẩm đã chọn khỏi giỏ hàng.' });
    } catch (error) {
        console.error('Lỗi khi xóa nhiều sản phẩm khỏi giỏ hàng:', error);
        return res.status(500).json({ message: 'Lỗi server' });
    }
});

// ------------------ Favorite ------------------

// Lấy danh sách sản phẩm yêu thích của user
router.get('/favorite/:user_id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const favorites = await FavoriteModel.find({ user_id: req.params.user_id });

    // Lấy thông tin chi tiết từng sản phẩm
    const detailedFavorites = await Promise.all(favorites.map(async (item) => {
        const product = await ProductModel.findById(item.product_id);
        return {
            product_id: item.product_id,
            product_name: product?.name || '',
            product_image: product?.image_url || '',
            product_price: product?.price || 0
        };
    }));

    res.send(detailedFavorites);
});


// Thêm sản phẩm vào danh sách yêu thích
router.post('/favorite/add', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { user_id, product_id } = req.body;

    if (!user_id || !product_id) {
        return res.status(400).send({ message: 'Thiếu dữ liệu' });
    }

    const existing = await FavoriteModel.findOne({ user_id, product_id });
    if (existing) {
        return res.status(200).send({ message: 'Đã có trong danh sách yêu thích' });
    }

    const favorite = await FavoriteModel.create({ user_id, product_id });
    res.send(favorite);
});

// Xóa sản phẩm khỏi danh sách yêu thích
router.delete('/favorite/remove', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { user_id, product_id } = req.body;

    if (!user_id || !product_id) {
        return res.status(400).send({ message: 'Thiếu dữ liệu' });
    }

    await FavoriteModel.deleteOne({ user_id, product_id });
    res.send({ message: 'Đã xóa khỏi danh sách yêu thích' });
});


// ------------------ Address ------------------
// Lấy địa chỉ 
router.get('/address/:user_id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const addresses = await AddressModel.find({ user_id: req.params.user_id });
    res.send(addresses);
});

// Thêm địa chỉ mới
router.post('/address/add', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { user_id, name, phone, city, ward, street } = req.body;

    if (!user_id || !name || !phone || !city || !ward || !street) {
        return res.status(400).send({ message: 'Thiếu thông tin' });
    }

    const newAddress = await AddressModel.create({
        user_id,
        name,
        phone,
        city,
        ward,
        street
    });

    res.send(newAddress);
});

// Xóa địa chỉ
router.delete('/address/remove/:address_id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    await AddressModel.findByIdAndDelete(req.params.address_id);
    res.send({ message: 'Đã xóa địa chỉ' });
});

// Cập nhập địa chỉ
router.put('/address/update/:address_id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const updated = await AddressModel.findByIdAndUpdate(req.params.address_id, req.body, { new: true });
    res.send(updated);
});

// Đặt địa chỉ default
router.put('/address/set-default', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { user_id, address_id } = req.body;

    if (!user_id || !address_id) {
        return res.status(400).send({ message: 'Thiếu dữ liệu' });
    }

    await AddressModel.updateMany({ user_id }, { is_default: false });
    await AddressModel.findByIdAndUpdate(address_id, { is_default: true });

    res.send({ message: 'Đã cập nhật địa chỉ mặc định' });
});

// Lấy địa chỉ mặc định của user
router.get('/address/default/:user_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const address = await AddressModel.findOne({ user_id: req.params.user_id, is_default: true });
        if (address) {
            res.status(200).json(address);
        } else {
            // Trả về 200 OK với object rỗng hoặc null nếu không tìm thấy,
            // để frontend không báo lỗi JSON Parse, mà xử lý logic "không có địa chỉ mặc định"
            res.status(200).json({});
        }
    } catch (error) {
        console.error("Lỗi khi lấy địa chỉ mặc định từ DB:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy địa chỉ mặc định', error: error.message });
    }
});

// ------------------ Payment ------------------
// Lấy tài khoản ngân hàng 
router.get('/bank/:user_id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const banks = await BankModel.find({ user_id: req.params.user_id });
    res.send(banks);
});

// Thêm tài khoản mới
router.post('/bank/add', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { user_id, card_number, card_holder, expiry_date } = req.body;

    if (!user_id || !card_number || !card_holder || !expiry_date) {
        return res.status(400).send({ message: 'Thiếu dữ liệu' });
    }

    const newBank = await BankModel.create({ user_id, card_number, card_holder, expiry_date });
    res.send(newBank);
});


// Xóa tài khoản
router.delete('/bank/remove/:id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    await BankModel.findByIdAndDelete(req.params.id);
    res.send({ message: 'Đã xóa tài khoản ngân hàng' });
});


// Cập nhập tài khoản
router.put('/bank/update/:id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { card_number, card_holder, expiry_date } = req.body;

    if (!card_number || !card_holder || !expiry_date) {
        return res.status(400).send({ message: 'Thiếu dữ liệu cập nhật' });
    }

    const updatedBank = await BankModel.findByIdAndUpdate(
        req.params.id,
        { card_number, card_holder, expiry_date },
        { new: true }
    );

    res.send(updatedBank);
});

// Đặt tài khoản default
router.put('/bank/set-default', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { user_id, bank_id } = req.body;

    if (!user_id || !bank_id) {
        return res.status(400).send({ message: 'Thiếu dữ liệu' });
    }

    await BankModel.updateMany({ user_id }, { is_default: false });
    await BankModel.findByIdAndUpdate(bank_id, { is_default: true });

    res.send({ message: 'Cập nhật mặc định thành công' });
});

// Lấy tài khoản ngân hàng mặc định của user
router.get('/bank/default/:user_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const bank = await BankModel.findOne({ user_id: req.params.user_id, is_default: true });
        if (bank) {
            res.status(200).json(bank);
        } else {
            // Tương tự, trả về 200 OK với object rỗng hoặc null
            res.status(200).json({});
        }
    } catch (error) {
        console.error("Lỗi khi lấy thẻ ngân hàng mặc định từ DB:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy thẻ ngân hàng mặc định', error: error.message });
    }
});


// ------------------ Order ------------------
// Thêm Đặt hàng
router.post('/order/create', async (req, res) => {
    // Đảm bảo kết nối MongoDB đã được thiết lập trước khi chạy try/catch
    await mongoose.connect(COMMON.uri);

    try {
        // Lấy dữ liệu từ body của request
        // total_amount, shipping_fee, discount_amount TỪ FRONTEND ĐƯỢC COI LÀ TỔNG CỦA CẢ GIỎ HÀNG GỐC
        const { user_id, items, address_id, bank_id, payment_method, shipping_fee, discount_amount, voucher_id, total_amount } = req.body;

        // Kiểm tra dữ liệu đầu vào cần thiết
        if (!user_id || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'Thiếu dữ liệu đơn hàng hoặc danh sách sản phẩm trống' });
        }

        // Lấy thông tin chi tiết của từng sản phẩm từ database
        // Bao gồm restaurant_id, name, image_url và đảm bảo giá
        const detailedItems = await Promise.all(items.map(async (item) => {
            const product = await ProductModel.findById(item.product_id).lean(); // Dùng .lean() để tăng hiệu suất đọc
            if (!product) {
                // Log lỗi chi tiết nếu sản phẩm không tìm thấy
                console.error(`Lỗi: Không tìm thấy sản phẩm với ID: ${item.product_id}`);
                throw new Error(`Không tìm thấy sản phẩm ${item.product_id}`);
            }
            return {
                product_id: item.product_id,
                product_name: product.name,
                product_image: product.image_url,
                quantity: item.quantity,
                // Ưu tiên giá từ frontend (price_at_order) nếu có, nếu không thì lấy giá hiện tại của sản phẩm
                price: item.price_at_order !== undefined ? item.price_at_order : product.price,
                restaurant_id: product.restaurant_id
            };
        }));

        // Nhóm sản phẩm theo restaurant_id để tạo các đơn hàng riêng lẻ cho từng nhà hàng
        const grouped = {};
        for (let item of detailedItems) {
            const restaurantId = item.restaurant_id.toString(); // Chuyển ObjectId sang string để làm key
            if (!grouped[restaurantId]) {
                grouped[restaurantId] = [];
            }
            grouped[restaurantId].push(item);
        }

        // --- BẮT ĐẦU LOGIC MỚI ĐỂ PHÂN BỔ TỔNG TIỀN VÀ GIẢM GIÁ ---

        // 1. Tính tổng subtotal của TẤT CẢ các sản phẩm trong giỏ hàng ban đầu (trước khi tách đơn)
        // Đây là tổng tiền hàng trước khi áp dụng bất kỳ giảm giá hay phí ship nào
        let overall_subtotal = 0;
        for (let item of detailedItems) {
            overall_subtotal += item.price * item.quantity;
        }

        const createdOrders = []; // Mảng để lưu các đơn hàng đã tạo thành công

        // Tạo đơn hàng cho từng nhà hàng
        for (let [restaurant_id, groupItems] of Object.entries(grouped)) {
            // Tính tổng tiền sản phẩm cho nhà hàng này (subtotal của đơn hàng con)
            let subtotal_for_restaurant = 0;
            for (let item of groupItems) {
                subtotal_for_restaurant += item.price * item.quantity;
            }

            // Phí vận chuyển: Sẽ dùng giá trị shipping_fee từ req.body.
            // Nếu bạn muốn phí ship khác nhau cho mỗi nhà hàng, bạn cần logic lấy phí ship cho từng nhà hàng ở đây.
            // Hiện tại, nó sẽ là giá trị shipping_fee được gửi lên từ frontend (coi như phí ship cho cả giỏ hàng, và chúng ta gán cho mỗi đơn con)
            // HOẶC nếu bạn có một giá trị cố định khác, hãy thay đổi `shipping_fee || 0` bằng giá trị đó.
            const current_shipping_fee = shipping_fee || 0;

            let allocated_discount_amount = 0;
            // Tính toán phân bổ giảm giá nếu có discount_amount từ frontend và overall_subtotal > 0
            if (discount_amount && discount_amount > 0 && overall_subtotal > 0) {
                // Tính tỷ lệ subtotal của nhà hàng này so với tổng subtotal chung
                const ratio = subtotal_for_restaurant / overall_subtotal;
                // Phân bổ giảm giá dựa trên tỷ lệ này
                allocated_discount_amount = discount_amount * ratio;

                // Đảm bảo không giảm giá quá mức subtotal của nhà hàng
                // (ví dụ: nếu subtotal của nhà hàng là 100k, giảm giá được phân bổ là 120k thì chỉ giảm 100k)
                allocated_discount_amount = Math.min(allocated_discount_amount, subtotal_for_restaurant);

                // Làm tròn để tránh số thập phân quá dài
                allocated_discount_amount = parseFloat(allocated_discount_amount.toFixed(2)); // Làm tròn 2 chữ số thập phân
            }

            // Tính tổng tiền cho đơn hàng con này: tổng sản phẩm - giảm giá được phân bổ + phí ship
            const total_amount_for_this_order = subtotal_for_restaurant - allocated_discount_amount + current_shipping_fee;

            const order = new OrderModel({
                user_id,
                restaurant_id, // ID của nhà hàng hiện tại từ nhóm sản phẩm
                address_id: address_id,
                bank_id: bank_id,
                payment_method: payment_method || 'COD',
                // Lưu các sản phẩm chi tiết của nhóm này vào đơn hàng
                items: groupItems.map(item => ({
                    product_id: item.product_id,
                    product_name: item.product_name,
                    product_image: item.product_image,
                    quantity: item.quantity,
                    price: item.price,
                })),
                total_amount: parseFloat(total_amount_for_this_order.toFixed(2)), // Lưu total_amount đã tính toán cho đơn hàng con
                shipping_fee: current_shipping_fee, // Lưu phí ship đã xác định cho đơn hàng con
                discount_amount: allocated_discount_amount, // Lưu số tiền giảm giá đã phân bổ cho đơn hàng con
                voucher_id: voucher_id || null, // Vẫn lưu voucher_id để biết đơn hàng này có sử dụng voucher nào
                status: 'Pending' // Trạng thái ban đầu của đơn hàng
            });

            await order.save(); // Lưu đơn hàng vào cơ sở dữ liệu
            createdOrders.push(order); // Thêm đơn hàng đã tạo vào danh sách

            // --- CẬP NHẬT 'purchases' CHO TỪNG SẢN PHẨM ĐÃ ĐẶT ---
            for (const item of groupItems) { // Lặp qua từng sản phẩm trong nhóm này (đơn hàng hiện tại)
                try {
                    await ProductModel.findByIdAndUpdate(
                        item.product_id,
                        { $inc: { purchases: item.quantity } }, // Tăng purchases lên số lượng đã mua
                        { new: true } // Trả về tài liệu đã cập nhật (không bắt buộc dùng ở đây nhưng là thói quen tốt)
                    );
                    // console.log(`Đã tăng purchases cho sản phẩm ${item.product_id} thêm ${item.quantity}`);
                } catch (productUpdateError) {
                    console.error(`Lỗi khi cập nhật purchases cho sản phẩm ${item.product_id}:`, productUpdateError);
                    // Có thể xử lý lỗi cụ thể ở đây (ví dụ: ghi log vào một dịch vụ khác)
                }
            }
        }

        // --- Xóa giỏ hàng của người dùng SAU KHI TẤT CẢ ĐƠN HÀNG ĐƯỢC TẠO THÀNH CÔNG ---
        // await CartModel.deleteOne({ user_id: user_id });

        // --- Tăng used_count của voucher nếu có (SAU KHI TẤT CẢ ĐƠN HÀNG ĐƯỢC TẠO) ---
        // Phần này chỉ cần chạy một lần cho toàn bộ giao dịch, không cần lặp trong mỗi đơn hàng con.
        if (voucher_id) {
            try {
                await VoucherModel.findByIdAndUpdate(
                    voucher_id,
                    { $inc: { used_count: 1 } }
                );
                // console.log(`Đã tăng used_count cho voucher ${voucher_id}`);
            } catch (voucherUpdateError) {
                console.error(`Lỗi khi cập nhật used_count của voucher ${voucher_id}:`, voucherUpdateError);
            }
        }

        // Gửi phản hồi thành công
        res.status(201).json({ message: 'Đặt hàng thành công!', orders: createdOrders });

    } catch (error) {
        // Xử lý lỗi nếu có bất kỳ vấn đề nào xảy ra trong quá trình tạo đơn hàng
        console.error("Lỗi khi tạo đơn hàng:", error);
        res.status(500).json({ message: 'Lỗi server khi tạo đơn hàng.', error: error.message });
    }
});

// Cập nhập trạng thái thanh toán 
router.put('/order/pay/:order_id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const order = await OrderModel.findByIdAndUpdate(
        req.params.order_id,
        { status: 'paid' },
        { new: true }
    );

    if (!order) {
        return res.status(404).send({ message: 'Không tìm thấy đơn hàng' });
    }

    // Xoá giỏ hàng của user sau khi thanh toán thành công
    // await CartModel.findOneAndDelete({ user_id: order.user_id });

    res.send({ message: 'Thanh toán thành công', order });
});

// Cập nhật router.get('/order/user/:user_id')
router.get('/order/user/:user_id', async (req, res) => {
    await mongoose.connect(COMMON.uri);
    const { user_id } = req.params;
    const { status } = req.query; // Lấy trạng thái từ query (e.g., /order/user/abc?status=Pending)

    let query = { user_id: user_id };
    if (status) {
        query.status = status;
    }

    // THÊM POPULATE VÀO ĐÂY ĐỂ LẤY THÔNG TIN ĐỊA CHỈ VÀ NGÂN HÀNG KHI LẤY DANH SÁCH ORDER
    const orders = await OrderModel.find(query)
        .populate('address_id') // Populate thông tin địa chỉ
        .populate('bank_id')    // Populate thông tin ngân hàng
        .sort({ createdAt: -1 })
        .lean(); // Luôn dùng .lean() khi chỉ đọc dữ liệu để hiệu suất tốt hơn

    // Thêm log để kiểm tra:

    res.send(orders);
});

// Giữ nguyên route chi tiết order này (vì nó đã đúng logic populate)
router.get('/order/:order_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const orderId = req.params.order_id;

        // console.log(`Đang tìm đơn hàng với ID: ${orderId}`);
        const order = await OrderModel.findById(orderId)
            .populate('address_id')
            .populate('bank_id')
            .lean();

        console.log("Kết quả Populate order:", order);

        if (!order) {
            console.log(`Không tìm thấy đơn hàng với ID: ${orderId}`);
            return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
        }

        res.status(200).json(order);

    } catch (error) {
        console.error("Lỗi khi lấy chi tiết đơn hàng:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy chi tiết đơn hàng', error: error.message });
    }
});

router.put('/order/cancel/:order_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const orderId = req.params.order_id;

        console.log(`Yêu cầu hủy đơn hàng với ID: ${orderId}`);

        // Tìm đơn hàng theo ID
        const order = await OrderModel.findById(orderId);

        if (!order) {
            console.log(`Không tìm thấy đơn hàng với ID: ${orderId} để hủy.`);
            return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
        }

        // Kiểm tra trạng thái đơn hàng: Chỉ cho phép hủy nếu trạng thái là 'Pending'
        if (order.status !== 'Pending') {
            console.log(`Không thể hủy đơn hàng ${orderId}. Trạng thái hiện tại: '${order.status}'.`);
            return res.status(400).json({ message: `Không thể hủy đơn hàng có trạng thái '${order.status}'. Chỉ đơn hàng 'Pending' mới có thể hủy.` });
        }

        // Cập nhật trạng thái của đơn hàng thành 'Cancelled'
        order.status = 'Cancelled';
        await order.save();

        console.log(`Đơn hàng ${orderId} đã được hủy thành công.`);
        res.status(200).json({ message: 'Đơn hàng đã được hủy thành công', order: order });

    } catch (error) {
        console.error("Lỗi khi hủy đơn hàng:", error);
        res.status(500).json({ message: 'Lỗi server khi hủy đơn hàng', error: error.message });
    } finally {
        // mongoose.connection.close();
    }
});

// =========================================================
//                  VOUCHER ROUTES
// =========================================================

// Route 1: Lấy tất cả voucher đang hoạt động và còn hiệu lực
// Có thể thêm query param để lọc voucher khả dụng cho user cụ thể sau này
router.get('/vouchers', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);

        const now = new Date();
        const availableVouchers = await VoucherModel.find({
            active: true,
            start_date: { $lte: now },
            end_date: { $gte: now },
            $or: [
                { usage_limit: { $eq: null } },
                {
                    usage_limit: { $ne: null },
                    $expr: { $lt: ['$used_count', '$usage_limit'] }
                }
            ]
        }).sort({ end_date: 1 });

        // Nếu populate thành công, restaurant_id sẽ là một object chứa { _id, restaurant_name }
        // Nếu không có restaurant_id, trường này sẽ là null
        const vouchersWithNames = await Promise.all(availableVouchers.map(async (voucher) => {
            const voucherObject = voucher.toObject();
            if (voucherObject.restaurant_id) {
                // Lấy tên nhà hàng từ model nhà hàng
                const restaurant = await UserModel.findById(voucherObject.restaurant_id);
                voucherObject.name = restaurant ? restaurant.name : 'Không xác định';
            } else {
                voucherObject.name = 'Hệ thống';
            }
            return voucherObject;
        }));

        res.status(200).json(vouchersWithNames);

    } catch (error) {
        console.error("Lỗi CHI TIẾT khi tải danh sách voucher:", error);
        res.status(500).json({ message: 'Lỗi server khi tải danh sách voucher', error: error.message });
    }
});

// Route: Lấy tất cả voucher của một nhà hàng theo restaurant_id
router.get('/vouchers/by-restaurant/:restaurant_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const { restaurant_id } = req.params;

        if (!restaurant_id) {
            return res.status(400).json({ message: 'Thiếu restaurant_id.' });
        }

        const vouchers = await VoucherModel.find({ restaurant_id: restaurant_id }).sort({ end_date: 1 });
        res.status(200).json(vouchers);
    } catch (error) {
        console.error("Lỗi khi lấy voucher theo nhà hàng:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy voucher theo nhà hàng', error: error.message });
    }
});

// Route 2: Lấy voucher theo ID (nếu cần xem chi tiết voucher nào đó)
router.get('/vouchers/:id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const voucher = await VoucherModel.findById(req.params.id);

        if (!voucher) {
            return res.status(404).json({ message: 'Không tìm thấy voucher' });
        }
        res.status(200).json(voucher);
    } catch (error) {
        console.error("Lỗi khi lấy voucher theo ID:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy voucher', error: error.message });
    }
});

// Route 3: Áp dụng/Kiểm tra tính hợp lệ của voucher (quan trọng cho màn thanh toán)
// Body: { code: "VOUCHERCODE", userId: "someUserId", totalAmount: 150 }
router.post('/vouchers/apply', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const { code, userId, totalAmount } = req.body;

        if (!code || !userId || totalAmount === undefined) {
            return res.status(400).json({ message: 'Thiếu thông tin cần thiết (code, userId, totalAmount).' });
        }

        const now = new Date();
        const voucher = await VoucherModel.findOne({ code: code.toUpperCase() });

        if (!voucher) {
            return res.status(404).json({ message: 'Mã voucher không tồn tại.' });
        }

        if (!voucher.active) {
            return res.status(400).json({ message: 'Mã voucher này không còn hiệu lực.' });
        }

        if (now < voucher.start_date || now > voucher.end_date) {
            return res.status(400).json({ message: 'Mã voucher này chưa đến thời gian áp dụng hoặc đã hết hạn.' });
        }

        if (voucher.usage_limit !== null && voucher.used_count >= voucher.usage_limit) {
            return res.status(400).json({ message: 'Mã voucher này đã hết lượt sử dụng.' });
        }

        if (totalAmount < voucher.min_order_amount) {
            return res.status(400).json({ message: `Đơn hàng tối thiểu để áp dụng voucher là ${voucher.min_order_amount}$.` });
        }

        let discountAmount = 0;
        if (voucher.discount_type === 'percentage') {
            discountAmount = totalAmount * (voucher.discount_value / 100);
            if (voucher.max_discount_amount !== null && discountAmount > voucher.max_discount_amount) {
                discountAmount = voucher.max_discount_amount;
            }
        } else if (voucher.discount_type === 'fixed') {
            discountAmount = voucher.discount_value;
        }

        // Trả về thông tin voucher và số tiền giảm giá
        res.status(200).json({
            message: 'Voucher hợp lệ!',
            voucher: voucher,
            discount_amount: discountAmount,
            final_amount: totalAmount - discountAmount
        });

    } catch (error) {
        console.error("Lỗi khi áp dụng voucher:", error);
        res.status(500).json({ message: 'Lỗi server khi áp dụng voucher', error: error.message });
    } finally {
        // mongoose.connection.close();
    }
});

// router.post('/vouchers/apply', async (req, res) => {
//     try {
//         await mongoose.connect(COMMON.uri);
//         const { code, userId, cartItems } = req.body;

//         if (!code || !userId || !cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
//             return res.status(400).json({ message: 'Thiếu thông tin cần thiết (code, userId, cartItems).' });
//         }

//         const now = new Date();
//         const voucher = await VoucherModel.findOne({ code: code.toUpperCase() });

//         if (!voucher) return res.status(404).json({ message: 'Mã voucher không tồn tại.' });
//         if (!voucher.active || now < voucher.start_date || now > voucher.end_date) {
//             return res.status(400).json({ message: 'Mã voucher không còn hiệu lực hoặc đã hết hạn.' });
//         }
//         if (voucher.usage_limit !== null && voucher.used_count >= voucher.usage_limit) {
//             return res.status(400).json({ message: 'Mã voucher này đã hết lượt sử dụng.' });
//         }

//         const totalAmount = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

//         if (totalAmount < voucher.min_order_amount) {
//             return res.status(400).json({ message: `Đơn hàng tối thiểu để áp dụng voucher là ${voucher.min_order_amount}$.` });
//         }

//         let applicableAmount = 0;
//         const SYSTEM_VOUCHER_ID = '687cc05d14b65a03d366454f'; 

//         if (voucher.restaurant_id && voucher.restaurant_id.toString() === SYSTEM_VOUCHER_ID) {
//             applicableAmount = totalAmount;
//         } else if (voucher.restaurant_id) {
//             const applicableItems = cartItems.filter(item => 
//                 item.restaurantId.toString() === voucher.restaurant_id.toString()
//             );
//             if (applicableItems.length === 0) {
//                 return res.status(400).json({ message: 'Voucher này chỉ áp dụng cho sản phẩm của một nhà hàng cụ thể không có trong giỏ hàng của bạn.' });
//             }
//             applicableAmount = applicableItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
//         } else {
//             // Trường hợp không có restaurant_id (coi như toàn hệ thống)
//             applicableAmount = totalAmount;
//         }

//         let discountAmount = 0;
//         if (voucher.discount_type === 'percentage') {
//             discountAmount = applicableAmount * (voucher.discount_value / 100);
//             if (voucher.max_discount_amount && discountAmount > voucher.max_discount_amount) {
//                 discountAmount = voucher.max_discount_amount;
//             }
//         } else if (voucher.discount_type === 'fixed') {
//             discountAmount = voucher.discount_value;
//         }

//         discountAmount = Math.min(applicableAmount, Math.max(0, discountAmount));

//         res.status(200).json({
//             message: 'Voucher hợp lệ!',
//             voucher: voucher,
//             discount_amount: discountAmount,
//             final_amount: totalAmount - discountAmount,
//         });

//     } catch (error) {
//         console.error("Lỗi khi áp dụng voucher:", error);
//         res.status(500).json({ message: 'Lỗi server khi áp dụng voucher', error: error.message });
//     } finally {
//         // mongoose.connection.close();
//     }
// });

router.put('/vouchers/increase-used-count/:id', async (req, res) => {
    try {
        const voucherId = req.params.id;
        const voucher = await VoucherModel.findById(voucherId); // Tìm voucher bằng ID

        if (!voucher) {
            return res.status(404).json({ message: 'Voucher không tìm thấy.' });
        }

        voucher.used_count += 1; // Tăng used_count lên 1
        await voucher.save(); // Lưu thay đổi vào cơ sở dữ liệu

        res.status(200).json({ message: 'Used count đã được cập nhật thành công.', voucher });
    } catch (error) {
        console.error('Lỗi khi cập nhật used_count của voucher:', error);
        res.status(500).json({ message: 'Lỗi server khi cập nhật voucher.' });
    }
});

// Sửa voucher theo ID
router.put('/vouchers/:id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const voucherId = req.params.id;
        const updateData = req.body; // Dữ liệu sửa gửi từ client

        const updatedVoucher = await VoucherModel.findByIdAndUpdate(
            voucherId,
            updateData,
            { new: true }
        );

        if (!updatedVoucher) {
            return res.status(404).json({ message: 'Không tìm thấy voucher để sửa.' });
        }

        res.status(200).json({ message: 'Sửa voucher thành công!', voucher: updatedVoucher });
    } catch (error) {
        console.error('Lỗi khi sửa voucher:', error);
        res.status(500).json({ message: 'Lỗi server khi sửa voucher.', error: error.message });
    }
});

// Xóa voucher theo ID
router.delete('/vouchers/:id', async (req, res) => {
    try {
        const voucherId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(voucherId)) {
            return res.status(400).json({ message: 'ID không hợp lệ.' });
        }

        const deletedVoucher = await VoucherModel.findByIdAndDelete(voucherId);

        if (!deletedVoucher) {
            return res.status(404).json({ message: 'Không tìm thấy voucher để xoá.' });
        }

        res.status(200).json({ message: 'Xoá voucher thành công!', voucher: deletedVoucher });
    } catch (error) {
        console.error('Lỗi khi xoá voucher:', error);
        res.status(500).json({ message: 'Lỗi server khi xoá voucher.', error: error.message });
    }
});

// Thêm mới voucher
router.post('/vouchers', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const {
            code,
            description,
            discount_type,
            discount_value,
            min_order_amount,
            max_discount_amount,
            start_date,
            end_date,
            usage_limit,
            restaurant_id
        } = req.body;

        if (!restaurant_id) {
            return res.status(400).json({ message: 'Thiếu restaurant_id!' });
        }

        const newVoucher = new VoucherModel({
            code,
            description,
            discount_type,
            discount_value,
            min_order_amount,
            max_discount_amount,
            start_date,
            end_date,
            usage_limit,
            used_count: 0,
            user_specific: false,
            active: true,
            restaurant_id, // ⚠️ Quan trọng: phải lưu
        });

        await newVoucher.save();

        res.status(201).json({ message: 'Tạo voucher thành công!', voucher: newVoucher });
    } catch (error) {
        console.error('Lỗi khi thêm voucher:', error);
        res.status(500).json({ message: 'Lỗi server khi thêm voucher.', error: error.message });
    }
});

// =========================================================
//         CÁC ROUTE QUẢN LÝ ĐƠN HÀNG DÀNH CHO ADMIN
//         (Đơn giản hóa tối đa, không middleware)
// =========================================================


// 1. Lấy TẤT CẢ đơn hàng của MỘT NHÀ HÀNG CỤ THỂ
// Admin sẽ gửi restaurant_id trong URL. Có thể lọc theo trạng thái (status)
// Ví dụ: GET /admin/orders/by-restaurant/654321abcdef1234567890ab?status=Pending
router.get('/admin/orders/by-restaurant/:restaurant_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const { status } = req.query; // Lấy status từ query parameter
        const restaurantId = req.params.restaurant_id; // Lấy restaurant_id trực tiếp từ URL params

        let query = { restaurant_id: restaurantId };
        if (status) {
            query.status = status;
        }

        const orders = await OrderModel.find(query)
            .populate('user_id', 'name phone email')
            .populate('address_id')
            .populate('bank_id')
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json(orders);
    } catch (error) {
        console.error("Lỗi khi lấy danh sách đơn hàng cho admin (theo nhà hàng):", error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách đơn hàng', error: error.message });
    }
});


// 2. Endpoint để Cập nhật trạng thái của đơn hàng bởi Admin (XÁC NHẬN)
// Admin gửi order_id trong URL và new_status, restaurant_id trong body.
// Ví dụ: PUT /admin/order/update-status/12345
// Body: { "new_status": "Completed", "restaurant_id": "654321abcdef1234567890ab" }
router.put('/admin/order/update-status/:order_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const orderId = req.params.order_id;
        const { new_status, restaurant_id } = req.body;

        if (!new_status || !restaurant_id) {
            return res.status(400).json({ message: 'Thiếu trạng thái mới hoặc ID nhà hàng để cập nhật.' });
        }

        // Định nghĩa các trạng thái MÀ FRONTEND ĐANG GỬI LÊN VÀ BACKEND CHẤP NHẬN
        // Đây là nơi bạn định nghĩa các trạng thái hợp lệ mà đơn hàng có thể chuyển sang.
        // Ví dụ: 'Processing', 'Delivered', 'Cancelled'
        const validStatusesForUpdate = ['Processing', 'Delivered', 'Cancelled']; // ĐÃ SỬA TẠI ĐÂY!
        if (!validStatusesForUpdate.includes(new_status)) {
            return res.status(400).json({ message: `Trạng thái không hợp lệ: ${new_status}. Chỉ chấp nhận: ${validStatusesForUpdate.join(', ')} cho việc cập nhật.` });
        }

        // Tìm đơn hàng và đảm bảo nó thuộc về nhà hàng của admin
        const order = await OrderModel.findOne({ _id: orderId, restaurant_id: restaurant_id });

        if (!order) {
            return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc đơn hàng không thuộc nhà hàng của bạn.' });
        }

        // --- Logic kiểm tra chuyển đổi trạng thái (RẤT QUAN TRỌNG) ---
        // Không thể cập nhật trạng thái nếu đơn hàng đã bị hủy hoặc đã giao (trạng thái cuối cùng)
        if (order.status === 'Cancelled' || order.status === 'Delivered') { // ĐÃ SỬA 'Completed' thành 'Delivered'
            return res.status(400).json({ message: `Không thể cập nhật trạng thái của đơn hàng đã ${order.status === 'Cancelled' ? 'hủy' : 'giao hàng'}.` });
        }

        // Các quy tắc chuyển đổi cụ thể:
        if (order.status === 'Pending') {
            if (new_status !== 'Processing' && new_status !== 'Cancelled') {
                return res.status(400).json({ message: 'Đơn hàng đang chờ chỉ có thể chuyển sang "Đang xử lý" hoặc "Đã hủy".' });
            }
        } else if (order.status === 'Processing') {
            if (new_status !== 'Delivered' && new_status !== 'Cancelled') {
                return res.status(400).json({ message: 'Đơn hàng đang xử lý chỉ có thể chuyển sang "Đã giao hàng" hoặc "Đã hủy".' });
            }
        }
        // Thêm các trường hợp khác nếu cần (ví dụ: không cho phép quay ngược trạng thái)
        // Ví dụ: if (new_status === 'Pending' && (order.status === 'Processing' || order.status === 'Delivered')) { ... }

        order.status = new_status;
        await order.save();

        res.status(200).json({ message: `Đơn hàng đã cập nhật trạng thái thành '${new_status}' thành công.`, order: order });

    } catch (error) {
        console.error("Lỗi khi cập nhật trạng thái đơn hàng bởi admin:", error);
        res.status(500).json({ message: 'Lỗi server khi cập nhật trạng thái đơn hàng', error: error.message });
    }
});


// 3. Endpoint để XÓA một đơn hàng bởi Admin (HỦY ĐƠN)
// Admin sẽ gửi order_id và restaurant_id trong URL.
// Ví dụ: DELETE /admin/order/delete/12345/654321abcdef1234567890ab
router.delete('/admin/order/delete/:order_id/:restaurant_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const orderId = req.params.order_id;
        const restaurantId = req.params.restaurant_id; // Lấy restaurant_id trực tiếp từ URL params

        // Đảm bảo chỉ xóa đơn hàng thuộc về nhà hàng của admin
        const result = await OrderModel.deleteOne({ _id: orderId, restaurant_id: restaurantId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc đơn hàng không thuộc nhà hàng của bạn để xóa.' });
        }

        res.status(200).json({ message: 'Đơn hàng đã được xóa thành công.' });
    } catch (error) {
        console.error("Lỗi khi xóa đơn hàng bởi admin:", error);
        res.status(500).json({ message: 'Lỗi server khi xóa đơn hàng', error: error.message });
    }
});

// 4. Lấy chi tiết một đơn hàng cụ thể của một nhà hàng
// Admin gửi order_id và restaurant_id trong URL params.
// Ví dụ: GET /admin/order/detail/654321abcd1234567890def1/654321abcdef1234567890ab
router.get('/admin/order/detail/:order_id/:restaurant_id', async (req, res) => {
    try {
        // Kết nối đến MongoDB
        // Đảm bảo COMMON.uri chứa chuỗi kết nối MongoDB của bạn
        // Nếu bạn đã có kết nối global ở server.js, có thể bỏ qua dòng này
        await mongoose.connect(COMMON.uri);

        const { order_id, restaurant_id } = req.params; // Lấy order_id và restaurant_id từ URL params

        if (!order_id || !restaurant_id) {
            return res.status(400).json({ message: 'Thiếu ID đơn hàng hoặc ID nhà hàng trong yêu cầu.' });
        }

        // Tìm đơn hàng dựa trên _id và restaurant_id
        // Sử dụng populate để lấy thông tin chi tiết từ các collection liên quan
        const order = await OrderModel.findOne({
            _id: order_id,
            restaurant_id: restaurant_id
        })
            .populate('user_id', 'name phone email') // Lấy tên, số điện thoại, email của người dùng
            .populate('address_id') // Lấy thông tin địa chỉ đầy đủ (nếu có)
            .populate('bank_id') // Lấy thông tin ngân hàng (nếu có)
            .lean(); // Sử dụng .lean() để trả về plain JavaScript object, giúp tăng hiệu suất

        if (!order) {
            return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc đơn hàng không thuộc nhà hàng của bạn.' });
        }

        res.status(200).json(order);
    } catch (error) {
        console.error("Lỗi khi lấy chi tiết đơn hàng cho admin:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy chi tiết đơn hàng', error: error.message });
    }
});


// ------------------ RESTAURANT ------------------
// Lấy thông tin nhà hàng theo ID
router.get('/restaurant/:id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri); // Kết nối MongoDB
        const restaurant = await UserModel.findById(req.params.id); // Tìm nhà hàng theo ID

        if (!restaurant) {
            // Nếu không tìm thấy nhà hàng, trả về lỗi 404 với JSON
            return res.status(404).json({ message: 'Không tìm thấy nhà hàng.' });
        }

        // Nếu tìm thấy, trả về dữ liệu nhà hàng dưới dạng JSON
        res.status(200).json(restaurant); // Trả về JSON thành công

    } catch (error) {
        console.error("Lỗi khi lấy thông tin nhà hàng theo ID:", error);
        // Trả về lỗi server 500 với JSON
        res.status(500).json({ message: 'Lỗi server khi lấy thông tin nhà hàng.', error: error.message });
    }
});


router.post('/reviews/submit', async (req, res) => {
    // Đảm bảo kết nối MongoDB đã được thiết lập (hoặc bỏ đi nếu đã có kết nối toàn cục)
    await mongoose.connect(COMMON.uri);

    try {
        const { orderId, userId, restaurantId, productReviews, restaurantReview } = req.body;

        // 1. Kiểm tra dữ liệu đầu vào
        if (!orderId || !userId || !restaurantId || !Array.isArray(productReviews) || !restaurantReview) {
            return res.status(400).json({ message: 'Thiếu dữ liệu đánh giá bắt buộc.' });
        }

        // 2. Kiểm tra xem đơn hàng đã tồn tại và thuộc về người dùng này chưa
        const order = await OrderModel.findOne({ _id: orderId, user_id: userId, restaurant_id: restaurantId });
        if (!order) {
            return res.status(404).json({ message: 'Không tìm thấy đơn hàng hợp lệ để đánh giá.' });
        }

        // >>> KIỂM TRA ĐƠN HÀNG ĐÃ ĐƯỢC ĐÁNH GIÁ CHƯA HOẶC CHƯA ĐƯỢC GIAO <<<
        if (order.status === 'Rated') { // Kiểm tra nếu trạng thái đã là 'Rated'
            return res.status(400).json({ message: 'Đơn hàng này đã được đánh giá rồi.' });
        }
        // Thêm kiểm tra nếu bạn chỉ cho phép đánh giá đơn hàng đã 'Delivered'
        if (order.status !== 'Delivered') {
            return res.status(400).json({ message: 'Chỉ có thể đánh giá đơn hàng đã được giao.' });
        }


        // 3. Xử lý và lưu đánh giá nhà hàng
        if (restaurantReview.rating > 0) {
            const restaurant = await UserModel.findById(restaurantId);
            if (restaurant && restaurant.role === 'Admin') { // Giả định role 'Restaurant'
                const currentRestaurantRating = restaurant.rating || 0;
                const currentRestaurantNumReviews = restaurant.num_reviews || 0;

                const newTotalRating = (currentRestaurantRating * currentRestaurantNumReviews) + restaurantReview.rating;
                restaurant.num_reviews = currentRestaurantNumReviews + 1;
                restaurant.rating = restaurant.num_reviews > 0 ? parseFloat((newTotalRating / restaurant.num_reviews).toFixed(2)) : 0;

                await restaurant.save();

                const newRestaurantReviewDoc = new ReviewSModel({
                    entity_id: restaurantId,
                    entity_type: 'Restaurant',
                    user_id: userId,
                    order_id: orderId,
                    rating: restaurantReview.rating,
                    comment: restaurantReview.comment,
                });
                await newRestaurantReviewDoc.save();
            } else {
                console.warn(`Không tìm thấy nhà hàng (User có role 'Restaurant') với ID: ${restaurantId} để cập nhật rating.`);
            }
        }

        // 4. Xử lý và lưu đánh giá từng sản phẩm
        for (const pr of productReviews) {
            if (pr.rating > 0) {
                const product = await ProductModel.findById(pr.productId);
                if (product) {
                    const currentRating = product.rating || 0;
                    const currentNumReviews = product.num_reviews || 0;

                    const newTotalRating = (currentRating * currentNumReviews) + pr.rating;
                    product.num_reviews = currentNumReviews + 1;
                    product.rating = product.num_reviews > 0 ? parseFloat((newTotalRating / product.num_reviews).toFixed(2)) : 0;

                    await product.save();

                    const newProductReviewDoc = new ReviewSModel({
                        entity_id: pr.productId,
                        entity_type: 'Product',
                        user_id: userId,
                        order_id: orderId,
                        rating: pr.rating,
                        comment: pr.comment,
                    });
                    await newProductReviewDoc.save();
                } else {
                    console.warn(`Không tìm thấy sản phẩm với ID: ${pr.productId} để cập nhật rating.`);
                }
            }
        }

        // >>> CẬP NHẬT TRẠNG THÁI CỦA ĐƠN HÀNG THÀNH 'Rated' <<<
        order.status = 'Rated';
        await order.save();

        res.status(200).json({ message: 'Đánh giá đã được gửi thành công.' });

    } catch (error) {
        console.error("Lỗi khi xử lý đánh giá:", error);
        res.status(500).json({ message: 'Lỗi server khi gửi đánh giá.', error: error.message });
    }
});

router.get('/reviews/product/:productId', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const { productId } = req.params;

        // Đảm bảo chỉ có điều kiện này. Không có validate nào khác cho entity_type ở đây.
        const reviews = await ReviewSModel.find({ entity_id: productId, entity_type: 'Product' })
            .populate('user_id', 'name avatar_url')
            .sort({ createdAt: -1 })
            .lean();

        const formattedReviews = reviews.map(review => ({
            _id: review._id,
            rating: review.rating,
            comment: review.comment,
            createdAt: review.createdAt,
            userName: review.user_id?.name || 'Người dùng ẩn danh',
            userAvatar: review.user_id?.avatar_url,
        }));

        res.status(200).json(formattedReviews);

    } catch (error) {
        console.error("Lỗi khi lấy đánh giá sản phẩm:", error); // Tìm dòng này trong console backend
        // Backend chỉ nên trả về lỗi 500 nếu có lỗi nội bộ, không phải lỗi validation entity_type ở đây
        res.status(500).json({ message: 'Lỗi server khi lấy đánh giá sản phẩm.', error: error.message });
    } finally {
        // Đóng kết nối nếu bạn quản lý kết nối thủ công
    }
});

router.get('/reviews/user/:userId', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);
        const { userId } = req.params;

        const reviewsRaw = await ReviewSModel.find({ user_id: userId })
            .populate('user_id', 'name avatar_url')
            .sort({ createdAt: -1 })
            .lean();

        const populatedReviewsPromises = reviewsRaw.map(async (review) => {
            let entityName = '';
            let rawEntityImage = null;
            let additionalInfo = {};

            if (review.entity_type === 'Restaurant') {
                const restaurantEntity = await UserModel.findById(review.entity_id)
                    .select('name avatar_url phone') // <-- Đã đổi 'address' thành 'phone', bỏ 'categories'
                    .lean();

                if (restaurantEntity) {
                    entityName = restaurantEntity.name;
                    rawEntityImage = restaurantEntity.avatar_url;
                    additionalInfo = {
                        phoneNumber: restaurantEntity.phone || null, // <-- Sử dụng 'phoneNumber' để tránh trùng tên và rõ ràng hơn
                    };
                } else {
                    console.warn(`[Backend]: Không tìm thấy nhà hàng với ID: ${review.entity_id}`);
                    entityName = 'Nhà hàng không rõ (ID không tồn tại)';
                    additionalInfo = { phoneNumber: null }; //
                }
            } else if (review.entity_type === 'Product') {
                const productEntity = await ProductModel.findById(review.entity_id)
                    .select('name image_url price restaurant_id')
                    .populate('restaurant_id', 'name') // Populate tên nhà hàng bán sản phẩm
                    .lean();

                if (productEntity) {
                    entityName = productEntity.name;
                    rawEntityImage = productEntity.image_url;
                    additionalInfo = {
                        price: productEntity.price !== undefined ? productEntity.price : null,
                        restaurantName: productEntity.restaurant_id ? productEntity.restaurant_id.name : null, // <-- Đã sửa lỗi ở đây
                    };
                } else {
                    console.warn(`[Backend]: Không tìm thấy sản phẩm với ID: ${review.entity_id}`);
                    entityName = 'Sản phẩm không rõ (ID không tồn tại)';
                    additionalInfo = { price: null, restaurantName: null };
                }
            } else {
                entityName = 'Loại thực thể không rõ';
                additionalInfo = {};
            }

            const formattedReview = {
                _id: review._id,
                entity_id: review.entity_id,
                entity_type: review.entity_type,
                entityName: entityName,
                entityImage: rawEntityImage,
                rating: review.rating,
                comment: review.comment,
                createdAt: review.createdAt,
                userName: review.user_id?.name,
                userAvatar: review.user_id?.avatar_url,
                ...additionalInfo,
            };

            return formattedReview;
        });

        const finalReviews = await Promise.all(populatedReviewsPromises);
        res.status(200).json(finalReviews);

    } catch (error) {
        console.error("Lỗi khi lấy đánh giá của người dùng:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy đánh giá của người dùng.', error: error.message });
    } finally {
        // Đóng kết nối nếu bạn quản lý kết nối thủ công
        // if (mongoose.connection.readyState === 1) { // Chỉ đóng nếu đang mở
        //     mongoose.connection.close();
        // }
    }
});
// Lấy danh sách đánh giá cho một entity (nhà hàng hoặc sản phẩm)
router.get('/reviews/:entityType/:entityId', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri); // Kết nối MongoDB

        const { entityType, entityId } = req.params;

        // Kiểm tra entityType hợp lệ (ví dụ: 'Restaurant', 'Product')
        if (!['Restaurant', 'Product'].includes(entityType)) {
            return res.status(400).json({ message: 'Loại thực thể không hợp lệ. Phải là "Restaurant" hoặc "Product".' });
        }

        // Tìm tất cả đánh giá cho entity_id và entity_type cụ thể
        const reviews = await ReviewSModel.find({
            entity_id: entityId,
            entity_type: entityType
        }).sort({ createdAt: -1 }) // Sắp xếp đánh giá mới nhất lên trước
            .populate('user_id', 'name avatar_url'); // Lấy thêm tên và avatar của người dùng đã đánh giá

        if (!reviews || reviews.length === 0) {
            return res.status(200).json([]); // Trả về mảng rỗng nếu không có đánh giá
        }

        res.status(200).json(reviews);

    } catch (error) {
        console.error("Lỗi khi lấy danh sách đánh giá:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy đánh giá.', error: error.message });
    }
});


router.get('/reviews/product', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);

        // Lấy restaurantId từ query parameter
        const restaurantId = req.query.restaurantId;

        let query = { entity_type: 'Product' };

        if (restaurantId) {
            // Bước 1: Tìm tất cả các sản phẩm (menu_item) thuộc về nhà hàng này
            // Đảm bảo ProductModel/menu_itemModel của bạn có trường restaurant_id
            const products = await mongoose.model('menu_item').find({ restaurant_id: restaurantId }).select('_id');
            const productIds = products.map(product => product._id);

            // Bước 2: Thêm điều kiện lọc vào query của ReviewSModel
            // Tìm các reviews mà entity_id của chúng nằm trong danh sách productIds
            query.entity_id = { $in: productIds };
        }

        const productReviews = await ReviewSModel.find(query) // Áp dụng query có điều kiện lọc
            .populate({
                path: 'entity_id',
                model: 'menu_item',
                // ✅ RẤT QUAN TRỌNG: Bao gồm 'restaurant_id' ở đây để có thể dùng cho lọc hoặc kiểm tra lại nếu cần
                select: 'name description image_url restaurant_id'
            })
            .populate({
                path: 'user_id',
                model: 'user',
                select: 'name avatar_url'
            })
            .sort({ createdAt: -1 });

        // Filter ra các đánh giá mà entity_id và user_id không null (đã populate thành công)
        // và optionally lọc lại một lần nữa theo restaurant_id để đảm bảo chắc chắn (nếu cần)
        const validAndFilteredProductReviews = productReviews.filter(review =>
            review.entity_id !== null &&
            review.user_id !== null &&
            // Lọc chính xác nếu entity_id đã được populate với restaurant_id
            (restaurantId ? review.entity_id.restaurant_id && review.entity_id.restaurant_id.toString() === restaurantId : true)
        );

        if (!validAndFilteredProductReviews || validAndFilteredProductReviews.length === 0) {
            return res.status(200).json([]);
        }

        res.status(200).json(validAndFilteredProductReviews);

    } catch (error) {
        console.error("Lỗi khi lấy đánh giá sản phẩm:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy đánh giá sản phẩm.', error: error.message });
    } finally {
        // Tùy chọn: Ngắt kết nối MongoDB sau mỗi yêu cầu nếu không dùng persistent connection
        // await mongoose.disconnect();
    }
});

// Thống kê doanh thu
const dayjs = require('dayjs'); // Cần cài: npm install dayjs

router.get('/admin/revenue/by-restaurant/:restaurant_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri); // Đảm bảo kết nối MongoDB

        const { restaurant_id } = req.params;
        const { startDate, endDate } = req.query;

        if (!mongoose.Types.ObjectId.isValid(restaurant_id)) {
            return res.status(400).json({ message: 'restaurant_id không hợp lệ' });
        }

        const queryConditions = {
            restaurant_id,
            status: { $in: ['Delivered', 'Rated'] }
        };

        if (startDate && endDate) {
            const startOfDay = dayjs(startDate).startOf('day').toDate();
            const endOfDay = dayjs(endDate).endOf('day').toDate();

            queryConditions.createdAt = {
                $gte: startOfDay,
                $lte: endOfDay
            };
        }

        const completedOrders = await OrderModel.find(queryConditions).lean();

        let totalRevenue = 0;
        let todayRevenue = 0;
        const todayFormatted = dayjs().format('YYYY-MM-DD');
        let totalOrders = completedOrders.length;

        const revenueByDate = {};

        completedOrders.forEach(order => {
            const createdAt = dayjs(order.createdAt).format('YYYY-MM-DD');
            const amount = order.total_amount || 0;

            totalRevenue += amount;

            if (createdAt === todayFormatted) {
                todayRevenue += amount;
            }

            if (!revenueByDate[createdAt]) {
                revenueByDate[createdAt] = 0;
            }
            revenueByDate[createdAt] += amount;
        });

        // --- THAY ĐỔI LỚN Ở ĐÂY: Truy vấn topProducts dựa vào trường 'purchases' trong Menu_Item model ---
        const topProductsFromDB = await ProductModel.find({
            restaurant_id: restaurant_id // Lọc sản phẩm theo restaurant_id
        })
            .sort({ purchases: -1 }) // Sắp xếp giảm dần theo trường 'purchases'
            .limit(10) // Lấy top 10 sản phẩm
            .select('name image_url price purchases') // Chỉ chọn các trường cần thiết
            .lean();

        // Định dạng lại dữ liệu topProducts để khớp với cấu trúc frontend mong đợi
        const topProductsFormatted = topProductsFromDB.map(product => ({
            name: product.name,
            quantity: product.purchases || 0, // Sử dụng 'purchases' làm 'quantity'
            total: product.price * (product.purchases || 0), // Ước tính tổng doanh thu từ purchases (nếu cần hiển thị)
            image: product.image_url // Sử dụng image_url
        }));
        // --- KẾT THÚC THAY ĐỔI LỚN ---

        res.json({
            totalRevenue,
            todayRevenue,
            totalOrders,
            revenueByDate,
            topProducts: topProductsFormatted // Gửi mảng topProducts đã được truy vấn và định dạng
        });

    } catch (error) {
        console.error('Lỗi khi thống kê doanh thu:', error);
        res.status(500).json({ message: 'Lỗi server khi thống kê doanh thu', error: error.message });
    }
});

// Endpoint mới để lấy tất cả thống kê cho dashboard
router.get('/admin/dashboard-stats/by-restaurant/:restaurant_id', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri);

        const { restaurant_id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(restaurant_id)) {
            return res.status(400).json({ message: 'restaurant_id không hợp lệ.' });
        }
        const restaurantObjectId = new mongoose.Types.ObjectId(restaurant_id);


        // --- 1. Thống kê tổng quan đơn hàng và doanh thu ---

        // Lấy tổng số đơn hàng trong DB (tất cả các trạng thái, không giới hạn thời gian)
        const totalOrdersCount = await OrderModel.countDocuments({ restaurant_id: restaurantObjectId });


        // Lấy dữ liệu 7 ngày gần nhất cho biểu đồ doanh thu
        const now = dayjs();
        const startOfToday = now.startOf('day').toDate();
        const sevenDaysAgo = now.subtract(6, 'day').startOf('day').toDate(); // Kể cả hôm nay là 7 ngày

        const recentCompletedOrders = await OrderModel.find({
            restaurant_id: restaurantObjectId,
            createdAt: { $gte: sevenDaysAgo, $lte: now.endOf('day').toDate() },
            status: { $in: ['Delivered', 'Rated'] } // Chỉ các trạng thái hoàn tất để tính doanh thu
        }).lean();

        let totalRevenue = 0;
        const revenueByDate = {};

        // Khởi tạo tất cả các ngày trong 7 ngày gần nhất với doanh thu 0
        let currentDate = dayjs(sevenDaysAgo);
        while (currentDate.toDate() <= now.toDate()) {
            revenueByDate[currentDate.format('YYYY-MM-DD')] = 0;
            currentDate = currentDate.add(1, 'day');
        }

        // Tính tổng doanh thu và doanh thu theo ngày từ recentCompletedOrders (chỉ trong 7 ngày)
        recentCompletedOrders.forEach(order => {
            const orderDate = dayjs(order.createdAt).format('YYYY-MM-DD');
            const amount = order.total_amount || 0;
            totalRevenue += amount;

            if (revenueByDate[orderDate] !== undefined) {
                revenueByDate[orderDate] += amount;
            }
        });


        // === ĐIỀU CHỈNH CHỖ NÀY: Thống kê trạng thái đơn hàng TỔNG CỘNG (cho cả hộp màu và Pie Chart) ===
        const allOrdersForStatus = await OrderModel.aggregate([
            { $match: { restaurant_id: restaurantObjectId } }, // Lấy tất cả đơn hàng của nhà hàng
            {
                $group: {
                    _id: '$status', // Nhóm theo trạng thái
                    count: { $sum: 1 } // Đếm số lượng đơn hàng cho mỗi trạng thái
                }
            }
        ]);

        const totalOrderStats = { completed: 0, pendingAndProcessing: 0, cancelled: 0 };
        allOrdersForStatus.forEach(item => {
            const status = item._id?.toLowerCase();
            if (status === 'delivered' || status === 'rated') {
                totalOrderStats.completed += item.count;
            } else if (status === 'pending' || status === 'processing') {
                totalOrderStats.pendingAndProcessing += item.count;
            } else if (status === 'cancelled') {
                totalOrderStats.cancelled += item.count;
            }
            // Có thể thêm các trạng thái khác nếu có
        });


        // --- 2. Đếm tổng số món ăn ---
        const totalProducts = await ProductModel.countDocuments({ restaurant_id: restaurantObjectId });

        // --- 3. Đếm tổng số đánh giá ---
        const totalRestaurantReviews = await ReviewSModel.countDocuments({
            entity_id: restaurantObjectId,
            entity_type: 'Restaurant'
        });

        const productIds = await ProductModel.find({ restaurant_id: restaurantObjectId }).select('_id').lean();
        const product_object_ids_array = productIds.map(p => p._id);

        const totalProductReviews = await ReviewSModel.countDocuments({
            entity_id: { $in: product_object_ids_array },
            entity_type: 'Product'
        });

        const totalReviews = totalRestaurantReviews + totalProductReviews;

        // --- 4. Lấy các đơn hàng gần đây nhất (vẫn giữ nguyên 5 đơn gần nhất) ---
        // Lấy 5 đơn hàng mới nhất (từ tất cả các đơn hàng, không giới hạn thời gian)
        const recentOrders = await OrderModel.find({ restaurant_id: restaurantObjectId })
            .sort({ createdAt: -1 })
            .limit(5)
            .select('total_amount status createdAt') // Chọn các trường cần thiết
            .lean();

        // Định dạng lại cho `recentOrders` để khớp với frontend
        const formattedRecentOrders = recentOrders.map(order => ({
            _id: order._id,
            total_amount: order.total_amount,
            status: order.status,
            order_date: order.createdAt
        }));


        // --- Trả về tất cả dữ liệu ---
        res.json({
            totalOrders: totalOrdersCount, // Tổng số đơn hàng trong DB
            totalRevenue: totalRevenue, // Tổng doanh thu 7 ngày gần nhất
            orderStats: totalOrderStats, // <--- Đã được sửa để là TỔNG CỘNG
            totalProducts: totalProducts,
            totalReviews: totalReviews,
            revenueByDate: revenueByDate,
            recentOrders: formattedRecentOrders
        });

    } catch (error) {
        console.error('Lỗi khi lấy thống kê dashboard:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy thống kê dashboard', error: error.message });
    } finally {
        // Tùy chọn: Đóng kết nối nếu bạn muốn
        // mongoose.connection.close();
    }
});

// ------------------ RESTAURANT ------------------
// Lấy thông tin nhà hàng theo ID
router.get('/restaurants/:id', async (req, res) => { // <-- Endpoint này được giữ nguyên
    try {
        await mongoose.connect(COMMON.uri); // Giữ nguyên dòng này theo yêu cầu của bạn, nhưng hãy xem xét lại

        const { id } = req.params;

        // Kiểm tra ID có phải là ObjectId hợp lệ không trước khi tìm kiếm
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'ID nhà hàng không hợp lệ.' });
        }

        const restaurant = await UserModel.findById(id).lean(); // Tìm theo ID trong UserModel

        if (!restaurant) {
            return res.status(404).json({ message: 'Không tìm thấy nhà hàng.' });
        }

        // Bạn có thể muốn kiểm tra thêm `restaurant.role` để đảm bảo nó là 'Restaurant' hoặc 'Admin'
        // if (restaurant.role !== 'Restaurant' && restaurant.role !== 'Admin') {
        //     return res.status(404).json({ message: 'ID này không thuộc về một nhà hàng.' });
        // }

        res.status(200).json(restaurant);

    } catch (error) {
        console.error("Lỗi khi lấy thông tin nhà hàng theo ID:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy thông tin nhà hàng.', error: error.message });
    } finally {
        // Có thể cần đóng kết nối nếu bạn mở nó trong mỗi request, nhưng không khuyến khích cách này.
        // if (mongoose.connection.readyState === 1) {
        //     await mongoose.disconnect();
        // }
    }
});

// Lấy tất cả các món ăn của một nhà hàng cụ thể theo restaurant_id
// Endpoint: GET /restaurants/:restaurantId/menu_items (thêm endpoint này)
router.get('/restaurants/:restaurantId/menu_items', async (req, res) => {
    try {
        await mongoose.connect(COMMON.uri); // Giữ nguyên dòng này theo yêu cầu của bạn, nhưng hãy xem xét lại

        const { restaurantId } = req.params;

        // Kiểm tra xem restaurantId có phải là ObjectId hợp lệ không
        // (Mặc dù ProductSchema.restaurant_id là String, nhưng dữ liệu thực tế thường là ObjectId string)
        if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
            return res.status(400).json({ message: 'ID nhà hàng không hợp lệ.' });
        }

        // Tìm tất cả các sản phẩm (ProductModel, collection 'menu_item') có restaurant_id khớp
        const menuItems = await ProductModel.find({
            restaurant_id: restaurantId,
            status: true
        }).lean();

        // Trả về mảng rỗng nếu không tìm thấy món ăn nào, thân thiện với frontend hơn là 404
        res.status(200).json(menuItems);

    } catch (error) {
        console.error('Lỗi khi lấy danh sách món ăn theo nhà hàng ID:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách món ăn.', error: error.message });
    } finally {
        // Có thể cần đóng kết nối nếu bạn mở nó trong mỗi request, nhưng không khuyến khích cách này.
        // if (mongoose.connection.readyState === 1) {
        //     await mongoose.disconnect();
        // }
    }
});

router.get('/addresses/user/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const address = await AddressModel.findOne({ user_id: userId }); // Tìm địa chỉ theo user_id (restaurantId)

        if (!address) {
            return res.status(404).json({ message: 'Không tìm thấy địa chỉ cho nhà hàng này.' });
        }
        res.json(address);
    } catch (err) {
        console.error('Lỗi khi lấy địa chỉ:', err);
        res.status(500).json({ message: 'Lỗi server khi lấy địa chỉ.' });
    }
});


// Middleware để kết nối MongoDB (hoặc bạn đã có kết nối toàn cục)
// Nếu bạn đã có kết nối toàn cục, có thể bỏ qua dòng này trong mỗi route
router.use(async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) { // Kiểm tra nếu chưa kết nối
        try {
            await mongoose.connect(COMMON.uri);
            // console.log("MongoDB connected for chat routes.");
        } catch (error) {
            console.error("Lỗi kết nối MongoDB:", error);
            return res.status(500).json({ message: "Lỗi server: Không thể kết nối cơ sở dữ liệu." });
        }
    }
    next();
});

// --- ROUTES CHAT ---

// 1. Tạo cuộc hội thoại MỚI hoặc LẤY cuộc hội thoại HIỆN CÓ
// Endpoint: POST /chat/conversation
// Body: { participant1Id: "userA_id", participant2Id: "userB_id" }
router.post('/chat/conversation', async (req, res) => {
    try {
        const { participant1Id, participant2Id } = req.body;

        if (!participant1Id || !participant2Id) {
            return res.status(400).json({ message: 'Thiếu ID của người tham gia.' });
        }

        if (!mongoose.Types.ObjectId.isValid(participant1Id) || !mongoose.Types.ObjectId.isValid(participant2Id)) {
            return res.status(400).json({ message: 'Một hoặc cả hai ID người tham gia không hợp lệ.' });
        }

        // Đảm bảo cả hai ID đều là chuỗi và được sắp xếp để nhất quán
        const participantsSorted = [participant1Id.toString(), participant2Id.toString()].sort();

        // Tạo một hash duy nhất từ mảng participants đã sắp xếp
        const pHash = crypto.createHash('sha256').update(participantsSorted.join(',')).digest('hex');

        // Sử dụng findOneAndUpdate với upsert: true
        const conversation = await ConversationModel.findOneAndUpdate(
            {
                // Truy vấn chỉ dựa vào participantsHash
                participantsHash: pHash
            },
            {
                $setOnInsert: {
                    // Đưa cả participants và participantsHash vào $setOnInsert
                    participants: participantsSorted.map(id => new mongoose.Types.ObjectId(id)), // Chuyển lại về ObjectId
                    participantsHash: pHash, // <-- ĐƯA participantsHash VÀO ĐÂY
                    createdAt: new Date()
                },
                $set: {
                    updatedAt: new Date()
                }
            },
            {
                new: true, // Trả về tài liệu sau khi cập nhật (hoặc tạo)
                upsert: true, // Nếu không tìm thấy, tạo một tài liệu mới
                setDefaultsOnInsert: true // Có thể bật lại nếu muốn áp dụng các giá trị default khác
            }
        );

        const newConversation = conversation.createdAt.getTime() === conversation.updatedAt.getTime();

        res.status(newConversation ? 201 : 200).json({
            message: newConversation ? 'Cuộc hội thoại mới đã được tạo.' : 'Cuộc hội thoại đã tồn tại.',
            conversationId: conversation._id,
            newConversation: newConversation
        });

    } catch (error) {
        console.error('Lỗi khi tạo/lấy cuộc hội thoại:', error);
        if (error.code === 11000) {
            return res.status(409).json({ message: 'Cuộc hội thoại này đã tồn tại.', error: error.message });
        }
        res.status(500).json({ message: 'Lỗi server khi tạo/lấy cuộc hội thoại.', error: error.message });
    }
});

// 2. Lấy danh sách TẤT CẢ cuộc hội thoại của một người dùng
// Endpoint: GET /chat/conversations/user/:userId
router.get('/chat/conversations/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: 'ID người dùng không hợp lệ.' });
        }

        console.log(`Backend: Fetching conversations for userId: ${userId}`);

        // Bước 1: Chỉ tìm cuộc hội thoại, không populate gì cả
        const rawConversations = await ConversationModel.find({
            participants: userId
        }).lean();
        console.log("Backend: Raw conversations (before populate):", JSON.stringify(rawConversations, null, 2));

        // Bước 2: Populate participants
        const conversationsWithParticipants = await ConversationModel.find({
            participants: userId
        })
            .populate({
                path: 'participants',
                select: 'name avatar_url role',
                model: 'user'
            }).lean();
        console.log("Backend: Conversations with participants populated:", JSON.stringify(conversationsWithParticipants, null, 2));

        // Bước 3: Populate lastMessage (dựa trên cùng một truy vấn)
        const conversationsWithLastMessage = await ConversationModel.find({
            participants: userId
        })
            .populate({
                path: 'lastMessage',
                select: 'message_text createdAt sender_id',
                model: 'message'
            }).lean();
        console.log("Backend: Conversations with lastMessage populated:", JSON.stringify(conversationsWithLastMessage, null, 2));

        // Bước 4: Populate cả hai và sort
        const conversations = await ConversationModel.find({
            participants: userId
        })
            .populate({
                path: 'participants',
                select: 'name avatar_url role',
                model: 'user'
            })
            .populate({
                path: 'lastMessage',
                select: 'message_text createdAt sender_id',
                model: 'message'
            })
            .sort({ updatedAt: -1 })
            .lean();
        console.log("Backend: Conversations with ALL populated (final query result):", JSON.stringify(conversations, null, 2));


        const formattedConversations = conversations.map(conv => {
            const otherParticipant = conv.participants.find(p => p._id.toString() !== userId);
            return {
                _id: conv._id,
                lastMessage: conv.lastMessage, // Sẽ là đối tượng đã được populate
                otherParticipant: otherParticipant ? {
                    _id: otherParticipant._id,
                    name: otherParticipant.name,
                    avatar_url: otherParticipant.avatar_url,
                    role: otherParticipant.role
                } : null,
            };
        });

        console.log("Backend: Formatted Conversations sent to frontend:", JSON.stringify(formattedConversations, null, 2));

        res.status(200).json(formattedConversations);

    } catch (error) {
        console.error('Lỗi khi lấy danh sách cuộc hội thoại:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách cuộc hội thoại.', error: error.message });
    }
});

// 3. Lấy tin nhắn của một cuộc hội thoại cụ thể
// Endpoint: GET /chat/messages/conversation/:conversationId
router.get('/chat/messages/conversation/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return res.status(400).json({ message: 'ID cuộc hội thoại không hợp lệ.' });
        }

        const messages = await MessageModel.find({ conversation_id: conversationId })
            .populate({
                path: 'sender_id',
                select: 'name avatar_url', // Lấy tên và avatar của người gửi
                model: 'user' // Đảm bảo đúng model
            })
            .sort({ createdAt: 1 }) // Sắp xếp theo thứ tự thời gian gửi tin nhắn (cũ nhất đến mới nhất)
            .lean();

        res.status(200).json(messages);

    } catch (error) {
        console.error('Lỗi khi lấy tin nhắn:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy tin nhắn.', error: error.message });
    }
});

// 4. Gửi một tin nhắn mới
// Endpoint: POST /chat/message
// Body: { conversationId: "conv_id", senderId: "sender_id", messageText: "Hello!" }
router.post('/chat/message', async (req, res) => {
    try {
        const { conversationId, senderId, messageText } = req.body;

        if (!conversationId || !senderId || !messageText) {
            return res.status(400).json({ message: 'Thiếu thông tin tin nhắn bắt buộc (conversationId, senderId, messageText).' });
        }

        if (!mongoose.Types.ObjectId.isValid(conversationId) || !mongoose.Types.ObjectId.isValid(senderId)) {
            return res.status(400).json({ message: 'ID cuộc hội thoại hoặc người gửi không hợp lệ.' });
        }

        // Tạo tin nhắn mới
        const newMessage = new MessageModel({
            conversation_id: conversationId,
            sender_id: senderId,
            message_text: messageText,
            status: 'sent'
        });
        await newMessage.save();

        // Cập nhật updatedAt của Conversation VÀ lastMessage
        await ConversationModel.findByIdAndUpdate(
            conversationId,
            {
                updatedAt: Date.now(),
                lastMessage: newMessage._id // <-- DÒNG NÀY RẤT QUAN TRỌNG
            }
        );

        // Populate thông tin người gửi để frontend hiển thị ngay
        const populatedMessage = await MessageModel.findById(newMessage._id)
            .populate('sender_id', 'name avatar_url')
            .lean();

        res.status(201).json({ message: 'Tin nhắn đã được gửi thành công.', message: populatedMessage });

    } catch (error) {
        console.error('Lỗi khi gửi tin nhắn:', error);
        res.status(500).json({ message: 'Lỗi server khi gửi tin nhắn.', error: error.message });
    }
});

// 5. Cập nhật trạng thái tin nhắn (ví dụ: đã đọc)
// Endpoint: PUT /chat/message/status/:messageId
// Body: { status: "read" }
router.put('/chat/message/status/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ message: 'Thiếu trạng thái mới.' });
        }

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({ message: 'ID tin nhắn không hợp lệ.' });
        }

        const validStatuses = ['sent', 'delivered', 'read'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: `Trạng thái không hợp lệ: ${status}. Các trạng thái hợp lệ: ${validStatuses.join(', ')}.` });
        }

        const updatedMessage = await MessageModel.findByIdAndUpdate(
            messageId,
            { status: status },
            { new: true } // Trả về tài liệu đã được cập nhật
        ).lean();

        if (!updatedMessage) {
            return res.status(404).json({ message: 'Không tìm thấy tin nhắn để cập nhật trạng thái.' });
        }

        res.status(200).json({ message: 'Trạng thái tin nhắn đã được cập nhật.', message: updatedMessage });

    } catch (error) {
        console.error('Lỗi khi cập nhật trạng thái tin nhắn:', error);
        res.status(500).json({ message: 'Lỗi server khi cập nhật trạng thái tin nhắn.', error: error.message });
    }
});

// Lấy  lại mật khẩu
router.use(async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) { // Kiểm tra nếu chưa kết nối
        try {
            await mongoose.connect(COMMON.uri);
            console.log("MongoDB connected for auth routes.");
        } catch (error) {
            console.error("Lỗi kết nối MongoDB:", error);
            return res.status(500).json({ message: "Lỗi server: Không thể kết nối cơ sở dữ liệu." });
        }
    }
    next();
});

// Cấu hình Nodemailer transporter
const transporter = nodemailer.createTransport({
    service: COMMON.emailService, // Hoặc host, port, secure
    auth: {
        user: COMMON.emailUser,
        pass: COMMON.emailPass,
    },
});

router.post('/request-password-reset-otp', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Vui lòng cung cấp địa chỉ email.' });
        }

        const user = await UserModel.findOne({ email: email });

        if (!user) {
            // Trả về thông báo thành công chung chung để tránh tiết lộ email nào tồn tại
            return res.status(200).json({ message: 'Nếu email của bạn tồn tại trong hệ thống, chúng tôi đã gửi một mã đặt lại mật khẩu đến email đó.' });
        }

        // Tạo mã OTP
        const otp = crypto.randomBytes(3).toString('hex').toUpperCase(); // Mã 6 ký tự ngẫu nhiên
        const otpExpires = Date.now() + COMMON.resetOtpExpiresMinutes * 60 * 1000; // Hết hạn sau X phút

        user.resetPasswordOtp = otp;
        user.resetPasswordExpires = otpExpires;
        await user.save();

        // Gửi email chứa mã OTP
        const mailOptions = {
            from: COMMON.emailUser,
            to: user.email,
            subject: 'Mã đặt lại mật khẩu của bạn',
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <h2 style="color: #f55;">Yêu cầu đặt lại mật khẩu</h2>
                    <p>Xin chào ${user.name || user.email},</p>
                    <p>Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản của mình. Vui lòng sử dụng mã OTP sau để hoàn tất quá trình:</p>
                    <h3 style="color: #f55; font-size: 24px; text-align: center; border: 2px dashed #f55; padding: 10px; display: inline-block;">${otp}</h3>
                    <p>Mã này sẽ hết hạn sau ${COMMON.resetOtpExpiresMinutes} phút.</p>
                    <p>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
                    <p>Trân trọng,<br/>Đội ngũ hỗ trợ của chúng tôi</p>
                </div>
            `,
        };

        await transporter.sendMail(mailOptions);

        res.status(200).json({ message: 'Mã đặt lại mật khẩu đã được gửi đến email của bạn.' });

    } catch (error) {
        console.error('Lỗi khi yêu cầu đặt lại mật khẩu:', error);
        res.status(500).json({ message: 'Lỗi server khi yêu cầu đặt lại mật khẩu.', error: error.message });
    }
});

router.post('/reset-password-otp', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        if (!email || !otp || !newPassword) {
            return res.status(400).json({ message: 'Vui lòng cung cấp email, mã OTP và mật khẩu mới.' });
        }

        const user = await UserModel.findOne({
            email: email,
            resetPasswordOtp: otp,
            resetPasswordExpires: { $gt: Date.now() } // Mã OTP còn hiệu lực
        });

        if (!user) {
            return res.status(400).json({ message: 'Mã OTP không hợp lệ hoặc đã hết hạn.' });
        }

        // Mã hóa mật khẩu mới
        const salt = await bcrypt.genSalt(10);
        user.password_hash = await bcrypt.hash(newPassword, salt);

        // Xóa mã OTP và thời gian hết hạn sau khi đặt lại thành công
        user.resetPasswordOtp = undefined;
        user.resetPasswordExpires = undefined;

        await user.save();

        res.status(200).json({ message: 'Mật khẩu đã được đặt lại thành công.' });

    } catch (error) {
        console.error('Lỗi khi đặt lại mật khẩu:', error);
        res.status(500).json({ message: 'Lỗi server khi đặt lại mật khẩu.', error: error.message });
    }
});

router.get('/product/by-category-name', async (req, res) => {
    try {
        const { name } = req.query; // Lấy tên danh mục từ query parameter

        if (!name) {
            return res.status(400).json({ message: 'Tên danh mục là bắt buộc.' });
        }

        // Tìm kiếm các sản phẩm có category khớp với tên được truyền vào
        const products = await ProductModel.find({
            category: name, // Tìm sản phẩm có trường 'category' khớp với tên
            status: true // Chỉ lấy các sản phẩm đang hoạt động
        }).lean();

        res.status(200).json(products);
    } catch (error) {
        console.error('Lỗi khi lấy sản phẩm theo tên danh mục:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy sản phẩm.', error: error.message });
    }
});