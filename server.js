// const express = require('express');
// const bodyParser = require("body-parser");
// const mongoose = require('mongoose');
// const COMMON = require('./COMMON');
// const apiMobile = require('./api');

// const app = express();
// const port = 3000;

// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: true }));

// app.use('/api', apiMobile); // <-- chỉ gắn router

// app.listen(port, () => {
//     console.log(`Server chạy tại http://localhost:${port}`);
// });

// app.use('/uploads', express.static('uploads'));

const express = require('express');
const bodyParser = require("body-parser");
const mongoose = require('mongoose');
const COMMON = require('./COMMON'); // Đảm bảo COMMON.uri được định nghĩa trong file này
const apiMobile = require('./api'); // Các API hiện có của bạn

const app = express();
// const port = 3000;
const port = process.env.PORT || 3000;

// Middleware để xử lý JSON và URL-encoded data
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve các tệp tĩnh từ thư mục 'uploads'
app.use('/uploads', express.static('uploads'));

// --- KẾT NỐI MONGODB TOÀN CỤC ---
// Kết nối tới MongoDB một lần khi server khởi động
mongoose.connect(COMMON.uri)
    .then(() => {
        console.log('MongoDB đã kết nối thành công!');
    })
    .catch(err => {
        console.error('Lỗi kết nối MongoDB:', err);
        // Tùy chọn: Thoát ứng dụng nếu không thể kết nối DB
        process.exit(1);
    });

// Middleware để kiểm tra trạng thái kết nối MongoDB trong các request (tùy chọn)
// Đây là một ví dụ, nếu bạn đã kết nối toàn cục ổn định thì không cần thiết cho mỗi request
app.use((req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        // Trạng thái 0 = disconnected, 2 = connecting, 3 = disconnecting
        return res.status(503).json({ message: 'Dịch vụ hiện không khả dụng (Lỗi kết nối cơ sở dữ liệu).' });
    }
    next();
});

// Gắn router API của bạn
app.use('/api', apiMobile); // <-- Router chính của bạn, chứa các endpoint khác và giờ sẽ chứa cả chat

// Khởi động server
app.listen(port, () => {
    console.log(`Server chạy tại http://localhost:${port}`);
});