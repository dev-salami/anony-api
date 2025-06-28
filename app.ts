import express, { Request, Response, NextFunction, Application } from "express";
import dotenv from "dotenv";

import mongoose, { Document, Schema } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import rateLimit from "express-rate-limit";
import cors from "cors";
dotenv.config();

const app: Application = express();

// Type definitions
interface ILink extends Document {
  linkId: string;
  userKey: string;
  title: string;
  description: string;
  isActive: boolean;
  createdAt: Date;
}

interface IMessage extends Document {
  messageId: string;
  linkId: string;
  content: string;
  anonymousSenderId: string;
  timestamp: Date;
}

interface CreateLinkRequest {
  key: string;
  title?: string;
  description?: string;
}

interface SendMessageRequest {
  content: string;
}

interface AuthenticatedRequest extends Request {
  query: {
    key?: string;
    [key: string]: any;
  };
}

// Middleware
app.use(express.json());
app.use(cors());

// Rate limiting
const messageLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 messages per windowMs
  message: { error: "Too many messages sent, try again later." },
});

const linkLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // limit each IP to 5 link creations per hour
  message: { error: "Too many links created, try again later." },
});

// MongoDB Schemas
const linkSchema = new Schema<ILink>({
  linkId: {
    type: String,
    required: true,
    unique: true,
  },
  userKey: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    default: "Anonymous Messages",
  },
  description: {
    type: String,
    default: "Send me anonymous messages",
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const messageSchema = new Schema<IMessage>({
  messageId: {
    type: String,
    required: true,
    unique: true,
  },
  linkId: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
    maxLength: 1000,
  },
  anonymousSenderId: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const Link = mongoose.model<ILink>("Link", linkSchema);
const Message = mongoose.model<IMessage>("Message", messageSchema);

// Helper functions
const validateKey = (providedKey: string, storedKey: string): boolean => {
  return providedKey === storedKey;
};

const generateAnonymousSenderId = (): string => {
  const adjectives: string[] = [
    "Anonymous",
    "Secret",
    "Hidden",
    "Mystery",
    "Shadow",
  ];
  const animals: string[] = [
    "Fox",
    "Owl",
    "Cat",
    "Wolf",
    "Bear",
    "Eagle",
    "Raven",
  ];
  const numbers: number = Math.floor(Math.random() * 999) + 1;

  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];

  return `${adjective}${animal}${numbers}`;
};

// Routes

// 1. Create Link
app.post(
  "/api/links/create",
  linkLimit,
  async (
    req: Request<{}, {}, CreateLinkRequest>,
    res: Response
  ): Promise<any> => {
    try {
      const { key, title, description } = req.body;

      if (!key || key.length < 6) {
        return res.status(400).json({
          error: "Key is required and must be at least 6 characters long",
        });
      }

      const linkId: string = uuidv4().substring(0, 8); // Generate short unique ID

      const newLink = new Link({
        linkId,
        userKey: key,
        title: title || "Anonymous Messages",
        description: description || "Send me anonymous messages",
      });

      await newLink.save();

      res.status(201).json({
        success: true,
        linkId,
        shareUrl: `/share/${linkId}`,
        title: newLink.title,
        description: newLink.description,
        createdAt: newLink.createdAt,
      });
    } catch (error) {
      console.error("Error creating link:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// 2. Send Message
app.post(
  "/api/messages/:linkId/send",
  messageLimit,
  async (
    req: Request<{ linkId: string }, {}, SendMessageRequest>,
    res: Response
  ): Promise<any> => {
    try {
      const { linkId } = req.params;
      const { content } = req.body;

      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: "Message content is required" });
      }

      if (content.length > 1000) {
        return res
          .status(400)
          .json({ error: "Message too long (max 1000 characters)" });
      }

      // Check if link exists and is active
      const link: ILink | null = await Link.findOne({ linkId });
      if (!link) {
        return res.status(404).json({ error: "Link not found" });
      }

      if (!link.isActive) {
        return res
          .status(403)
          .json({ error: "This link is no longer accepting messages" });
      }

      const messageId: string = uuidv4();
      const anonymousSenderId: string = generateAnonymousSenderId();

      const newMessage = new Message({
        messageId,
        linkId,
        content: content.trim(),
        anonymousSenderId,
      });

      await newMessage.save();

      res.status(201).json({
        success: true,
        messageId,
        anonymousSenderId,
        timestamp: newMessage.timestamp,
        message: "Message sent successfully!",
      });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// 3. Get Messages (requires key)
app.get(
  "/api/messages/:linkId",
  async (req: AuthenticatedRequest, res: Response): Promise<any> => {
    try {
      const { linkId } = req.params;
      const { key } = req.query;

      if (!key) {
        return res.status(401).json({ error: "Key is required" });
      }

      // Verify link exists and key is correct
      const link: ILink | null = await Link.findOne({ linkId });
      if (!link) {
        return res.status(404).json({ error: "Link not found" });
      }

      if (!validateKey(key, link.userKey)) {
        return res.status(401).json({ error: "Invalid key" });
      }

      // Get all messages for this link
      const messages: IMessage[] = await Message.find({ linkId })
        .sort({ timestamp: -1 })
        .select("-_id -__v");

      res.json({
        success: true,
        linkInfo: {
          linkId: link.linkId,
          title: link.title,
          description: link.description,
          isActive: link.isActive,
          createdAt: link.createdAt,
        },
        messages,
        totalMessages: messages.length,
      });
    } catch (error) {
      console.error("Error retrieving messages:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get all links created by a user (requires key)
app.get(
  "/api/links",
  async (req: AuthenticatedRequest, res: Response): Promise<any> => {
    try {
      const { key } = req.query;

      if (!key) {
        return res.status(401).json({ error: "Key is required" });
      }

      // Find all links created with this key
      const links: ILink[] = await Link.find({ userKey: key })
        .sort({ createdAt: -1 })
        .select("-userKey -_id -__v");

      // Get message counts for each link
      const linksWithCounts = await Promise.all(
        links.map(async (link) => {
          const messageCount = await Message.countDocuments({
            linkId: link.linkId,
          });
          return {
            linkId: link.linkId,
            title: link.title,
            description: link.description,
            isActive: link.isActive,
            createdAt: link.createdAt,
            messageCount,
            shareUrl: `/share/${link.linkId}`,
          };
        })
      );

      res.json({
        success: true,
        links: linksWithCounts,
        totalLinks: linksWithCounts.length,
      });
    } catch (error) {
      console.error("Error retrieving user links:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// 4. Delete Message (requires key)
app.delete(
  "/api/messages/:messageId",
  async (req: AuthenticatedRequest, res: Response): Promise<any> => {
    try {
      const { messageId } = req.params;
      const { key } = req.query;

      if (!key) {
        return res.status(401).json({ error: "Key is required" });
      }

      // Find the message first
      const message: IMessage | null = await Message.findOne({
        messageId,
      });
      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }

      // Verify the key matches the link owner's key
      const link: ILink | null = await Link.findOne({
        linkId: message.linkId,
      });
      if (!link) {
        return res.status(404).json({ error: "Associated link not found" });
      }

      if (!validateKey(key, link.userKey)) {
        return res.status(401).json({ error: "Invalid key" });
      }

      // Delete the message
      await Message.deleteOne({ messageId });

      res.json({
        success: true,
        message: "Message deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting message:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// 5. Toggle Link Visibility (requires key)
app.post(
  "/api/links/:linkId/toggle-visibility",
  async (req: AuthenticatedRequest, res: Response): Promise<any> => {
    try {
      const { linkId } = req.params;
      const { key } = req.query;

      if (!key) {
        return res.status(401).json({ error: "Key is required" });
      }

      const link: ILink | null = await Link.findOne({ linkId });
      if (!link) {
        return res.status(404).json({ error: "Link not found" });
      }

      if (!validateKey(key, link.userKey)) {
        return res.status(401).json({ error: "Invalid key" });
      }

      // Toggle the active status
      link.isActive = !link.isActive;
      await link.save();

      res.json({
        success: true,
        linkId: link.linkId,
        isActive: link.isActive,
        message: `Link ${
          link.isActive ? "activated" : "deactivated"
        } successfully`,
      });
    } catch (error) {
      console.error("Error toggling link visibility:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get link info (public endpoint for displaying the message form)
app.get(
  "/api/links/:linkId/info",
  async (req: Request<{ linkId: string }>, res: Response): Promise<any> => {
    try {
      const { linkId } = req.params;

      const link: ILink | null = await Link.findOne({ linkId }).select(
        "-userKey -_id -__v"
      );
      if (!link) {
        return res.status(404).json({ error: "Link not found" });
      }

      res.json({
        success: true,
        linkInfo: {
          linkId: link.linkId,
          title: link.title,
          description: link.description,
          isActive: link.isActive,
          createdAt: link.createdAt,
        },
      });
    } catch (error) {
      console.error("Error getting link info:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
app.get("/", (req: Request, res: Response) => {
  res.send(
    "Welcome to the Anonymous Messages API! Use /api/links/create to create a link."
  );
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// 404 handler
// app.use("*", (req: Request, res: Response) => {
//   res.status(404).json({ error: "Endpoint not found" });
// });

// Database connection and server startup
const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(
      process.env.MONGO_URL || "mongodb://localhost:27017/anonymous-messages",
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      } as mongoose.ConnectOptions
    );
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
};

const PORT: number = parseInt(process.env.PORT || "3300", 10);

const startServer = async (): Promise<void> => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
};

startServer();

export default app;
