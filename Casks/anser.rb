cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.47"
  sha256 arm:   "e78b9a10e37645c66cb0f9a2440e99da38b6804a680ea097ea91eebdfbea9840",
         intel: "3f3d37e3e498042755459122467049699066275ccc2b31bd5f04d2924b82fd5b"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
