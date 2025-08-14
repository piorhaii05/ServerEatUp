const mongoose = require('mongoose');

const EatUpSchema = new mongoose.Schema({
    name: {type: String, default: '', required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String,  default: '', required: true },
    password_hash: { type: String, required: true },
    role: { type: String, default: 'User', required: true },
    avatar_url: { type: String, default: 'https://cdn2.fptshop.com.vn/small/avatar_trang_1_cd729c335b.jpg' },
    gender: {type: String, default: 'Chưa cập nhập'},
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5  
    },
    num_reviews: {
        type: Number,
        default: 0
    },  
    block: { type: Boolean, default: false },
    resetPasswordOtp: String,
    resetPasswordExpires: Date,
});

const ProductSchema = new mongoose.Schema({
    restaurant_id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true },
    image_url: { type: String, default: '' },
    status: { type: Boolean, default: true },
    rating: { type: Number, default: 5 },
    purchases: { type: Number, default: 0 },
    category:  {type: String },
    num_reviews: {
        type: Number,
        default: 0
    },
}, { timestamps: true }); 


const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  image_url: { type: String, required: true },
  color: {type: String,}
}); 

const CartSchema = new mongoose.Schema({
    user_id: { type: String, required: true },
    items: [
        {
            product_id: { type: String, required: true },
            quantity: { type: Number, default: 1 },
            restaurant_id: { type: String }
        }
    ]
});

const FavoriteSchema = new mongoose.Schema({
    user_id: { type: String, required: true },
    product_id: { type: String, required: true },
});

const AddressSchema = new mongoose.Schema({
    user_id: String,
    name: String,
    phone: String,
    city: String,
    ward: String,
    street: String,
    is_default: { type: Boolean, default: false }
});

const BankSchema = new mongoose.Schema({
    user_id: String,
    card_number: String,
    card_holder: String,
    expiry_date: String,
    is_default: { type: Boolean, default: false }
});

const OrderItemSchema = new mongoose.Schema({
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'menu_item' }, // Sử dụng ObjectId và ref để populate nếu cần sau này
    product_name: { type: String, required: true }, // THÊM DÒNG NÀY
    product_image: { type: String }, // THÊM DÒNG NÀY
    quantity: { type: Number, required: true },
    price: { type: Number, required: true } // Giá tại thời điểm đặt hàng
});

const OrderSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    restaurant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true }, // Giả sử restaurant_id cũng là user (nhà hàng)
    items: [OrderItemSchema], // Đảm bảo OrderItemSchema đã được định nghĩa ở đâu đó
    total_amount: { type: Number, required: true },
    // >>> CHỈ THÊM 'Rated' VÀO ENUM CỦA TRƯỜNG STATUS <<<
    status: { type: String, enum: ['Pending', 'Processing', 'Delivered', 'Cancelled', 'Rated'], default: 'Pending' },
    payment_method: { type: String, enum: ['COD', 'Bank Transfer', 'VNPAY'], required: true },
    address_id: { type: mongoose.Schema.Types.ObjectId, ref: 'address', default: null },
    bank_id: { type: mongoose.Schema.Types.ObjectId, ref: 'bank', default: null },
    shipping_fee: { type: Number, default: 0 },
    discount_amount: { type: Number, default: 0 },
}, { timestamps: true });


const VoucherSchema = new mongoose.Schema({
    code: {type: String,required: true,unique: true,trim: true,uppercase: true},
    description: {type: String,required: true,trim: true},
    discount_type: { type: String,enum: ['percentage', 'fixed'],required: true},
    discount_value: {type: Number,required: true,min: 0},
    min_order_amount: {type: Number,default: 0},
    max_discount_amount: {type: Number,default: null},
    start_date: { type: Date, required: true},
    end_date: { type: Date,required: true},
    usage_limit: { type: Number,default: null},
    used_count: {type: Number,default: 0},
    user_specific: {type: Boolean,default: false}, 
    active: {type: Boolean,default: true},
    // restaurant_id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Restaurant' },
    restaurant_id: { type: String, required: true },
}, { timestamps: true });

const ReviewSchema = new mongoose.Schema({
    entity_id: { type: mongoose.Schema.Types.ObjectId, required: true}, // ID của thực thể được đánh giá (nhà hàng hoặc sản phẩm)
    entity_type: { type: String, required: true, enum: ['Restaurant', 'Product'] }, // Loại thực thể
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
});

const MessageSchema = new mongoose.Schema({
    // ID của cuộc hội thoại mà tin nhắn này thuộc về
    conversation_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'conversation', // Tham chiếu đến ConversationModel
        required: true
    },
    // ID của người gửi tin nhắn
    sender_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user', // Tham chiếu đến UserModel (người gửi)
        required: true
    },
    // Nội dung tin nhắn
    message_text: {
        type: String,
        required: true,
        trim: true // Loại bỏ khoảng trắng ở đầu và cuối
    },
    // Trạng thái của tin nhắn (ví dụ: 'sent', 'delivered', 'read')
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent'
    },
    // Thời gian tin nhắn được gửi
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    // Tự động thêm `createdAt` (nhưng chúng ta đã định nghĩa thủ công để đặt default: Date.now)
    // Nếu bạn muốn `updatedAt` cho mỗi tin nhắn, hãy để timestamps: true
    timestamps: { createdAt: true, updatedAt: false } // Chỉ muốn createdAt
});

const ConversationSchema = new mongoose.Schema({
    participants: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user', // Hoặc 'Restaurant' nếu bạn có các model riêng biệt cho từng loại
            required: true
        }
    ],
    participantsHash: {
        type: String, // Chuỗi hash của mảng participants đã sắp xếp
        required: true,
        unique: true // Đảm bảo tính duy nhất của cuộc hội thoại
    },
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'message'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// --------------------------------------------------------------------------
// QUAN TRỌNG: Định nghĩa chỉ mục duy nhất trên mảng 'participants'
// Điều này yêu cầu mảng participants phải được sắp xếp để chỉ mục hoạt động đúng
// và coi [A, B] và [B, A] là giống nhau.
ConversationSchema.index({ participantsHash: 1 }, { unique: true });

const MessageModel = mongoose.model('message', MessageSchema);
const ConversationModel = mongoose.model('conversation', ConversationSchema);
const FavoriteModel = mongoose.model('favorite', FavoriteSchema);
const CartModel = mongoose.model('cart', CartSchema);
const UserModel = mongoose.model('user', EatUpSchema);
const ProductModel = mongoose.model('menu_item', ProductSchema);
const CategoryModel = mongoose.model('categorie', CategorySchema);
const AddressModel = mongoose.model('address', AddressSchema);
const BankModel = mongoose.model('bank', BankSchema);
const OrderModel = mongoose.model('order', OrderSchema);
const VoucherModel = mongoose.model('voucher', VoucherSchema);
const ReviewSModel = mongoose.model('review', ReviewSchema);

module.exports = { UserModel, ProductModel, CategoryModel, CartModel, FavoriteModel, AddressModel, BankModel, OrderModel, VoucherModel, ReviewSModel, ConversationModel, MessageModel };