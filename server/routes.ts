import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";

const execPromise = promisify(exec);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Project Routes
  app.get(api.projects.list.path, async (req, res) => {
    const projects = await storage.getProjects();
    res.json(projects);
  });

  app.post("/api/generate-out", async (req, res) => {
    const { inpContent, projectName } = req.body;
    if (!inpContent) {
      return res.status(400).json({ message: "INP content is required" });
    }

    const tempDir = path.join(process.cwd(), "temp");
    await fs.mkdir(tempDir, { recursive: true });

    const timestamp = Date.now();
    const safeProjectName = (projectName || "project").replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const inpPath = path.join(tempDir, `${safeProjectName}_${timestamp}.inp`);
    const outPath = path.join(tempDir, `${safeProjectName}_${timestamp}.out`);
    const exePath = path.join(process.cwd(), "attached_assets", "WHAMO_1770791542355.EXE");

    try {
      await fs.writeFile(inpPath, inpContent);

      // Attempt to run with wine first, then fallback to mock if it keeps failing
      // Replit sandbox often blocks wine due to syscall filtering.
      
      const command = `wine "${exePath}" "${inpPath}" "${outPath}"`;
      console.log(`Executing command: ${command}`);
      
      try {
        await execPromise(command);
        
        const outContent = await fs.readFile(outPath, "utf-8");
        return res.json({ 
          message: "Generation successful", 
          outContent,
          projectName: safeProjectName
        });
      } catch (execError: any) {
        console.error("WHAMO execution failed:", execError);
        
        // If it's a "Bad system call" or wine is missing, use a mock response for now
        // so the user isn't blocked, while explaining the limitation.
        if (execError.message.includes("Bad system call") || execError.message.includes("wine: not found")) {
           console.warn("Using mock .OUT generation due to environment restrictions on executing .EXE files.");
           
           // Generate a mock .OUT content based on the sample 1_OUT.OUT if available, 
           // or a generic valid-looking header.
           const mockOutContent = `WHAMO (Water Hammer and Mass Oscillation) Analysis Result
Project: ${safeProjectName}
Generated on: ${new Date().toLocaleString()}

ANALYSIS SUMMARY:
-----------------
Execution environment: Linux (Replit Sandbox)
Note: The analysis engine execution was simulated due to environment restrictions.

INPUT ECHO:
${inpContent.split('\n').map(line => '> ' + line).join('\n')}

COMPUTATIONAL RESULTS:
Time(s)    Node       Head(m)    Flow(m3/s)
0.00       HW         100.00     1.25
1.00       HW         100.00     1.24
...
Analysis completed successfully (Simulated).
`;
           return res.json({ 
             message: "Generation simulated (Analysis engine restricted in this environment)", 
             outContent: mockOutContent,
             projectName: safeProjectName,
             isSimulated: true
           });
        }

        throw execError;
      }
    } catch (error: any) {
      console.error("Generate .OUT error:", error);
      res.status(500).json({ message: "Error processing .OUT generation", error: error.message });
    }
  });

  app.get(api.projects.get.path, async (req, res) => {
    const project = await storage.getProject(Number(req.params.id));
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    res.json(project);
  });

  app.post(api.projects.create.path, async (req, res) => {
    try {
      const input = api.projects.create.input.parse(req.body);
      const project = await storage.createProject(input);
      res.status(201).json(project);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.put(api.projects.update.path, async (req, res) => {
    try {
      const input = api.projects.update.input.parse(req.body);
      const project = await storage.updateProject(Number(req.params.id), input);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }
      res.json(project);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.projects.delete.path, async (req, res) => {
    await storage.deleteProject(Number(req.params.id));
    res.status(204).send();
  });

  return httpServer;
}
