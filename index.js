const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 5000;

const app = express();

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.ncnuzzr.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if(!authHeader){
    return res.status(401).send({message: 'Unauthorized access'});
  }
  const token = authHeader.split(' ')[1]
  jwt.verify(token, process.env. ACCESS_TOKEN, function(err, decoded){
    if(err){
      return res.status(403).send({message: "Forbidden access"});
    }
    req.decoded = decoded;
    next();
  })
}

async function run() {
  try {
    const appointmentOptions = client.db("doctorsPortal").collection("appointmentOptions");
    const bookingsCollection = client.db("doctorsPortal").collection("bookings");
    const usersCollection = client.db("doctorsPortal").collection("users");
    const doctorsCollection = client.db("doctorsPortal").collection("doctors");
    const paymentsCollection = client.db("doctorsPortal").collection("payments");

    const verifyAdmin = async (req, res, next)=> {
      const decodedEmail = req.decoded.email;
      const query = {email: decodedEmail};
      const user = await usersCollection.findOne(query);
      
      if(user?.role !== "Admin"){
        return res.status(403).send({message: "Forbidden access....."});
      }
        next()
    };


    app.get("/jwt", async (req, res)=>{
      const {email} = req.query;
      const user = await usersCollection.findOne({email: email});
      if(user){
        const token = jwt.sign({email}, process.env.ACCESS_TOKEN, {expiresIn: '1d'})
        return res.send({access_token: token})
      }
      else {
        return res.status(403).send({message: 'Forbidden'});
      }
    })

    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const options = await appointmentOptions.find({}).toArray();
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();
      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        const bookedSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        option.slots = remainingSlots;
        // console.log(option.name, remainingSlots.length);
      });
      res.send(options);
    });

    app.get("/appointmentSpecialty", async (req, res) => {
        const result = await appointmentOptions.find({}).project({name: 1}).toArray();
        res.send(result);
    });

    app.get("/dashboard/payment/:id", async (req, res) => {
        const id= req.params.id;
        const query = {_id: ObjectId(id)};
        const result = await bookingsCollection.find(query).toArray();
        res.send(result);
    });

    app.get('/bookings', verifyJWT, async (req, res) => {
        const {email} = req.query;
        const decodedEmail = req.decoded.email;
        if(decodedEmail !== email) {
          return res.status(403).send({message: "Forbidden access"});
        }
        const query = {email: email}
        const results = await bookingsCollection.find(query).toArray();
        res.send(results);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const query ={
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      };
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if(alreadyBooked.length){
        const message = `You have already book ${booking.appointmentDate}`;
        return res.send({acknowledged: false, message})
      }

      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email;
      const query = {email};
      const user = await usersCollection.findOne(query);
      res.send({isAdmin: user?.role === "Admin"});
    });

    app.get("/users", async (req, res) => {
      const results = await usersCollection.find({}).toArray();
      res.send(results)
    });

    app.put('/users/admin/:id',verifyJWT, verifyAdmin, async (req, res) =>{
      const {id} = req.params;
      const filter = {_id: ObjectId(id)};
      const options = {upsert: true};
      const updateDoc = {
        $set: {
          role: 'Admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updateDoc, options)
      res.send(result);
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      const results = await usersCollection.insertOne(user);
      res.send(results);
    });

    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
        const doctors = await doctorsCollection.find({}).toArray();
        res.send(doctors);
    });

    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res)=> {
      const doctor = req.body;
      const results = await doctorsCollection.insertOne(doctor);
      res.send(results);
    });

    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const results = await doctorsCollection.deleteOne({_id: ObjectId(id)});
      res.send(results);
    });

    app.post('/create-payment-intent', async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
          currency: 'usd',
          amount: amount,
          "payment_method_types": [
              "card"
          ]
      });
      res.send({
          clientSecret: paymentIntent.client_secret,
      });
  });

    app.post('/payments', async (req, res) => {
        const payment = req.body;
        const results = await paymentsCollection.insertOne(payment);
        const id = payment.bookingId;
        const filter = {_id: ObjectId(id)};
        const updateDoc = {
          $set: {
            paid: true,
            transactionId: payment.transactionId
          }
        };
        const updateResult = await bookingsCollection.updateOne(filter, updateDoc);
        res.send(results);
    });

    //temporary routes for add something to database
    // app.get('/add', async (req, res) => {
    //   const filter = {};
    //   const options = {upsert: true};
    //   const updateDoc = {
    //     $set: {
    //       price: 99
    //     }
    //   }
    //   const result = await appointmentOptions.updateMany(filter, updateDoc, options)
    //   res.send(result)

    // })


  } finally {
  }
}
run().catch((err) => {
  console.log(err);
});

app.get("/", async (req, res) => {
  res.send("doctors-portal server is running");
});

app.listen(port, () => {
  console.log(`server running at ${port}`);
});
