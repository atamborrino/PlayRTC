name := "playrtc"

organization := "com.github.atamborrino"

version := "0.1.0"
 
scalaVersion := "2.10.2"
 
resolvers ++= Seq(
  "TypesafeRepo repository" at "http://repo.typesafe.com/typesafe/releases/"
)
 
libraryDependencies ++= Seq(
  "com.typesafe.play"  %% "play" % "2.2.0" % "provided"
)

// Publishing

val localMavenRepo = Path.userHome.absolutePath + "/Projects/maven-atamborrino/"

publishMavenStyle := true

publishTo := {
  if (version.value.trim.endsWith("SNAPSHOT"))
    Some(Resolver.file("snapshots", file(localMavenRepo + "/snapshots")))
  else
    Some(Resolver.file("releases", file(localMavenRepo + "/releases")))
}

// Github publish
lazy val ghPublish = taskKey[Unit]("Publish to your maven github repo")

ghPublish := {
  import scala.sys.process._  
  val mavenRepoFile = new java.io.File(localMavenRepo)
  val publishRef = organization.value + "." + name.value + " " + version.value
  println("\nPulling your Github maven repo...")
  if (Process("git pull", mavenRepoFile).! == 0) {
    // Publish to localMavenRepo
    println("\nPublishing to your local Git maven repo...")
    val _ = publish.value
    // Git add, commit and push
    println("\nWe will now push your local Git maven repo to Github...")
    Process("git add *", mavenRepoFile).!
    val commitMsg = "Publish " + publishRef
    if (Process(Seq("git", "commit",  "-m", commitMsg), mavenRepoFile).! == 0) {
      if (Process("git push", mavenRepoFile).! == 0) {
        println("\n" + publishRef + " has been sucessfully published to your Github maven repo.")
      } else {
        println("\nError during git push. Please retry.")
      }
    } else {
      println("\nNothing new to publish to your Github maven repo: it seems that your Github repo is up-to-date.")
    }
  } else {
    println("Error during git pull. Cannot continue.")
  }
}

